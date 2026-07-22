use serde::{Deserialize, Serialize};
use std::io::{self, Read};

const PROTOCOL_VERSION: &str = "1.0.0";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessRequest {
    pid: u32,
    executable_name: String,
    selected_by_user: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PointerRequest {
    entry_id: String,
    label: String,
    module: String,
    raw_address: String,
    root_offset: Option<String>,
    pointer_chain: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScannerRequest {
    protocol_version: String,
    request_id: String,
    #[serde(rename = "type")]
    request_type: String,
    process: ProcessRequest,
    pointers: Vec<PointerRequest>,
    max_read_bytes: Option<usize>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModuleSummary {
    name: String,
    base_address: String,
    size: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PointerHop {
    address: String,
    pointer_value: String,
    offset: String,
    next_address: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PointerResult {
    entry_id: String,
    label: String,
    module: String,
    raw_address: String,
    root_offset: Option<String>,
    pointer_chain_length: usize,
    status: String,
    reason: String,
    final_address: Option<String>,
    hops: Vec<PointerHop>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannerError {
    code: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannerResponse {
    protocol_version: &'static str,
    request_id: String,
    #[serde(rename = "type")]
    response_type: &'static str,
    ok: bool,
    process: Option<ProcessRequestEcho>,
    modules: Vec<ModuleSummary>,
    pointer_results: Vec<PointerResult>,
    error: Option<ScannerError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessRequestEcho {
    pid: u32,
    executable_name: String,
}

fn error_response(request_id: String, code: &str, message: impl Into<String>) -> ScannerResponse {
    ScannerResponse {
        protocol_version: PROTOCOL_VERSION,
        request_id,
        response_type: "POINTER_L2_RESULT",
        ok: false,
        process: None,
        modules: vec![],
        pointer_results: vec![],
        error: Some(ScannerError {
            code: code.to_string(),
            message: message.into(),
        }),
    }
}

fn read_request() -> Result<ScannerRequest, String> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .map_err(|error| format!("Failed to read stdin: {error}"))?;
    serde_json::from_str(&input).map_err(|error| format!("Invalid scanner JSON request: {error}"))
}

fn print_response(response: &ScannerResponse) {
    match serde_json::to_string(response) {
        Ok(value) => println!("{value}"),
        Err(error) => println!(
            "{{\"protocolVersion\":\"{}\",\"requestId\":\"unknown\",\"type\":\"POINTER_L2_RESULT\",\"ok\":false,\"error\":{{\"code\":\"serialization_failed\",\"message\":\"{}\"}}}}",
            PROTOCOL_VERSION,
            error
        ),
    }
}

fn parse_non_negative_offset(value: &str) -> Result<u64, String> {
    let trimmed = value.trim();
    if trimmed.starts_with('-') {
        return Err(format!("Negative offset is not allowed: {trimmed}"));
    }
    let unsigned = trimmed.strip_prefix('+').unwrap_or(trimmed);
    if let Some(hex) = unsigned
        .strip_prefix("0x")
        .or_else(|| unsigned.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16).map_err(|_| format!("Invalid hex offset: {trimmed}"));
    }
    if unsigned
        .chars()
        .any(|c| c.is_ascii_hexdigit() && c.is_ascii_alphabetic())
    {
        return u64::from_str_radix(unsigned, 16)
            .map_err(|_| format!("Invalid bare hex offset: {trimmed}"));
    }
    unsigned
        .parse::<u64>()
        .map_err(|_| format!("Invalid decimal offset: {trimmed}"))
}

fn hex(value: u64) -> String {
    format!("0x{value:x}")
}

#[cfg(not(windows))]
fn run_scanner(request: ScannerRequest) -> ScannerResponse {
    let _ = request.max_read_bytes;
    error_response(
        request.request_id,
        "unsupported_platform",
        "solith-readonly-scanner only supports Windows.",
    )
}

#[cfg(windows)]
mod windows_impl {
    use super::*;
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::Debug::ReadProcessMemory;
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, MODULEENTRY32W, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };
    use windows_sys::Win32::System::Memory::{
        VirtualQueryEx, MEMORY_BASIC_INFORMATION, MEM_COMMIT, PAGE_EXECUTE_READ,
        PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY, PAGE_GUARD, PAGE_NOACCESS, PAGE_READONLY,
        PAGE_READWRITE, PAGE_WRITECOPY,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };

    const DEFAULT_MAX_READ_BYTES: usize = 1_048_576;

    struct ProcessHandle(HANDLE);

    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    #[derive(Clone)]
    struct NativeModule {
        name: String,
        base: u64,
        size: u32,
    }

    fn last_error(prefix: &str) -> String {
        format!("{prefix} (GetLastError={})", unsafe { GetLastError() })
    }

    fn wide_to_string(buffer: &[u16]) -> String {
        let end = buffer
            .iter()
            .position(|value| *value == 0)
            .unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..end])
    }

    fn basename(value: &str) -> &str {
        value.rsplit(['\\', '/']).next().unwrap_or(value)
    }

    fn open_process(pid: u32) -> Result<ProcessHandle, ScannerError> {
        let handle =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
        if handle.is_null() {
            return Err(ScannerError {
                code: "access_denied".to_string(),
                message: last_error("OpenProcess read/query failed"),
            });
        }
        Ok(ProcessHandle(handle))
    }

    fn query_executable_name(handle: HANDLE) -> Result<String, ScannerError> {
        let mut buffer = vec![0u16; 32_768];
        let mut size = buffer.len() as u32;
        let ok = unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size) };
        if ok == 0 {
            return Err(ScannerError {
                code: "process_exited".to_string(),
                message: last_error("QueryFullProcessImageNameW failed"),
            });
        }
        Ok(basename(&String::from_utf16_lossy(&buffer[..size as usize])).to_string())
    }

    fn enumerate_modules(pid: u32) -> Result<Vec<NativeModule>, ScannerError> {
        let snapshot =
            unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
        if snapshot == INVALID_HANDLE_VALUE {
            return Err(ScannerError {
                code: "module_missing".to_string(),
                message: last_error("CreateToolhelp32Snapshot failed"),
            });
        }
        let snapshot_handle = ProcessHandle(snapshot);
        let mut modules = Vec::new();
        let mut entry: MODULEENTRY32W = unsafe { zeroed() };
        entry.dwSize = size_of::<MODULEENTRY32W>() as u32;

        let mut ok = unsafe { Module32FirstW(snapshot_handle.0, &mut entry) };
        while ok != 0 {
            modules.push(NativeModule {
                name: wide_to_string(&entry.szModule),
                base: entry.modBaseAddr as usize as u64,
                size: entry.modBaseSize,
            });
            ok = unsafe { Module32NextW(snapshot_handle.0, &mut entry) };
        }
        Ok(modules)
    }

    fn is_protected_module(name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        lower.contains("easyanticheat")
            || lower.contains("battleye")
            || lower == "vgc.dll"
            || lower == "vgk.sys"
            || lower.contains("xigncode")
    }

    fn find_module<'a>(modules: &'a [NativeModule], name: &str) -> Option<&'a NativeModule> {
        modules
            .iter()
            .find(|module| module.name.eq_ignore_ascii_case(name))
    }

    fn is_readable(protect: u32) -> bool {
        if protect & PAGE_GUARD != 0 || protect & PAGE_NOACCESS != 0 {
            return false;
        }
        matches!(
            protect & 0xff,
            PAGE_READONLY
                | PAGE_READWRITE
                | PAGE_WRITECOPY
                | PAGE_EXECUTE_READ
                | PAGE_EXECUTE_READWRITE
                | PAGE_EXECUTE_WRITECOPY
        )
    }

    fn readable_region_contains(handle: HANDLE, address: u64, size: usize) -> Result<bool, String> {
        if size == 0 || size > DEFAULT_MAX_READ_BYTES {
            return Ok(false);
        }
        let end = address
            .checked_add(size as u64)
            .ok_or_else(|| "Address range overflow.".to_string())?;
        let mut info: MEMORY_BASIC_INFORMATION = unsafe { zeroed() };
        let queried = unsafe {
            VirtualQueryEx(
                handle,
                address as usize as *const c_void,
                &mut info,
                size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        if queried == 0 {
            return Ok(false);
        }
        let base = info.BaseAddress as usize as u64;
        let region_end = base
            .checked_add(info.RegionSize as u64)
            .ok_or_else(|| "Memory region overflow.".to_string())?;
        Ok(info.State == MEM_COMMIT
            && is_readable(info.Protect)
            && address >= base
            && end <= region_end)
    }

    fn read_u64(handle: HANDLE, address: u64, max_read_bytes: usize) -> Result<u64, String> {
        if 8 > max_read_bytes {
            return Err("Pointer read exceeds configured read cap.".to_string());
        }
        if !readable_region_contains(handle, address, 8)? {
            return Err(format!(
                "Address {} is not inside a committed readable region.",
                hex(address)
            ));
        }
        let mut value = [0u8; 8];
        let mut bytes_read = 0usize;
        let ok = unsafe {
            ReadProcessMemory(
                handle,
                address as usize as *const c_void,
                value.as_mut_ptr() as *mut c_void,
                value.len(),
                &mut bytes_read,
            )
        };
        if ok == 0 || bytes_read != value.len() {
            return Err(last_error("ReadProcessMemory pointer read failed"));
        }
        Ok(u64::from_le_bytes(value))
    }

    fn validate_pointer(
        handle: HANDLE,
        modules: &[NativeModule],
        pointer: PointerRequest,
        max_read_bytes: usize,
    ) -> PointerResult {
        let mut result = PointerResult {
            entry_id: pointer.entry_id,
            label: pointer.label,
            module: pointer.module.clone(),
            raw_address: pointer.raw_address,
            root_offset: pointer.root_offset.clone(),
            pointer_chain_length: pointer.pointer_chain.len(),
            status: "l2_invalid_chain".to_string(),
            reason: String::new(),
            final_address: None,
            hops: vec![],
        };

        let Some(module) = find_module(modules, &pointer.module) else {
            result.status = "module_missing".to_string();
            result.reason = format!(
                "Module {} was not loaded in the selected process.",
                pointer.module
            );
            return result;
        };

        let Some(root_offset_raw) = pointer.root_offset.as_deref() else {
            result.status = "invalid_offset".to_string();
            result.reason = "Pointer entry has no root offset.".to_string();
            return result;
        };

        let root_offset = match parse_non_negative_offset(root_offset_raw) {
            Ok(value) => value,
            Err(error) => {
                result.status = "invalid_offset".to_string();
                result.reason = error;
                return result;
            }
        };

        if root_offset >= module.size as u64 {
            result.status = "root_out_of_module_range".to_string();
            result.reason = format!(
                "Pointer root offset {} is outside module {} size {}.",
                root_offset_raw, module.name, module.size
            );
            return result;
        }

        let mut address = match module.base.checked_add(root_offset) {
            Some(value) => value,
            None => {
                result.status = "invalid_offset".to_string();
                result.reason = "Pointer root address overflowed.".to_string();
                return result;
            }
        };

        for offset_raw in pointer.pointer_chain {
            let offset = match parse_non_negative_offset(&offset_raw) {
                Ok(value) => value,
                Err(error) => {
                    result.status = "l2_invalid_chain".to_string();
                    result.reason = error;
                    return result;
                }
            };

            let pointer_value = match read_u64(handle, address, max_read_bytes) {
                Ok(value) => value,
                Err(error) => {
                    result.status = "l2_unreadable".to_string();
                    result.reason = error;
                    result.final_address = Some(hex(address));
                    return result;
                }
            };

            let next_address = match pointer_value.checked_add(offset) {
                Some(value) => value,
                None => {
                    result.status = "l2_invalid_chain".to_string();
                    result.reason = "Pointer hop overflowed.".to_string();
                    return result;
                }
            };
            result.hops.push(PointerHop {
                address: hex(address),
                pointer_value: hex(pointer_value),
                offset: hex(offset),
                next_address: hex(next_address),
            });
            address = next_address;
        }

        match readable_region_contains(handle, address, 1) {
            Ok(true) => {
                result.status = "l2_resolved".to_string();
                result.reason = "Pointer chain resolved to a committed readable region without reading or writing the target value.".to_string();
                result.final_address = Some(hex(address));
            }
            Ok(false) => {
                result.status = "l2_unreadable".to_string();
                result.reason = format!(
                    "Final address {} is not inside a committed readable region.",
                    hex(address)
                );
                result.final_address = Some(hex(address));
            }
            Err(error) => {
                result.status = "l2_invalid_chain".to_string();
                result.reason = error;
            }
        }
        result
    }

    pub fn run_scanner(request: ScannerRequest) -> ScannerResponse {
        if request.protocol_version != PROTOCOL_VERSION {
            return error_response(
                request.request_id,
                "invalid_request",
                format!("Unsupported protocol version: {}", request.protocol_version),
            );
        }
        if request.request_type != "VALIDATE_POINTER_L2_READONLY" {
            return error_response(
                request.request_id,
                "invalid_request",
                format!("Unsupported request type: {}", request.request_type),
            );
        }
        if !request.process.selected_by_user {
            return error_response(
                request.request_id,
                "ambiguous_process",
                "Scanner requires an explicitly user-selected process.",
            );
        }

        let max_read_bytes = request.max_read_bytes.unwrap_or(DEFAULT_MAX_READ_BYTES);
        let handle = match open_process(request.process.pid) {
            Ok(handle) => handle,
            Err(error) => {
                return error_response(request.request_id, &error.code, error.message);
            }
        };

        let executable_name = match query_executable_name(handle.0) {
            Ok(name) => name,
            Err(error) => {
                return error_response(request.request_id, &error.code, error.message);
            }
        };
        if !executable_name.eq_ignore_ascii_case(&request.process.executable_name) {
            return error_response(
                request.request_id,
                "ambiguous_process",
                format!(
                    "Selected PID {} is {}, expected {}.",
                    request.process.pid, executable_name, request.process.executable_name
                ),
            );
        }

        let modules = match enumerate_modules(request.process.pid) {
            Ok(modules) => modules,
            Err(error) => {
                return error_response(request.request_id, &error.code, error.message);
            }
        };
        if let Some(module) = modules
            .iter()
            .find(|module| is_protected_module(&module.name))
        {
            return error_response(
                request.request_id,
                "protected_target",
                format!("Protected target indicator detected: {}", module.name),
            );
        }

        let pointer_results = request
            .pointers
            .into_iter()
            .map(|pointer| validate_pointer(handle.0, &modules, pointer, max_read_bytes))
            .collect::<Vec<_>>();
        let module_summaries = modules
            .into_iter()
            .map(|module| ModuleSummary {
                name: module.name,
                base_address: hex(module.base),
                size: module.size,
            })
            .collect::<Vec<_>>();

        ScannerResponse {
            protocol_version: PROTOCOL_VERSION,
            request_id: request.request_id,
            response_type: "POINTER_L2_RESULT",
            ok: true,
            process: Some(ProcessRequestEcho {
                pid: request.process.pid,
                executable_name,
            }),
            modules: module_summaries,
            pointer_results,
            error: None,
        }
    }
}

#[cfg(windows)]
fn run_scanner(request: ScannerRequest) -> ScannerResponse {
    windows_impl::run_scanner(request)
}

fn main() {
    let response = match read_request() {
        Ok(request) => run_scanner(request),
        Err(error) => error_response("unknown".to_string(), "invalid_request", error),
    };
    print_response(&response);
}
