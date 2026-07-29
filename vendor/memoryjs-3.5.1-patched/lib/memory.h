#pragma once
#ifndef MEMORY_H
#define MEMORY_H
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <TlHelp32.h>

class memory {
public:
  memory();
  ~memory();
  std::vector<MEMORY_BASIC_INFORMATION> getRegions(HANDLE hProcess);

  template <class dataType>
  dataType readMemory(HANDLE hProcess, DWORD64 address) {
    dataType cRead;
    ReadProcessMemory(hProcess, (LPVOID)address, &cRead, sizeof(dataType), NULL);
    return cRead;
  }

  BOOL readBuffer(HANDLE hProcess, DWORD64 address, SIZE_T size, char* dstBuffer) {
    return ReadProcessMemory(hProcess, (LPVOID)address, dstBuffer, size, NULL);
  }

  char readChar(HANDLE hProcess, DWORD64 address) {
    char value;
    ReadProcessMemory(hProcess, (LPVOID)address, &value, sizeof(char), NULL);
    return value;
	}

  BOOL readString(HANDLE hProcess, DWORD64 address, std::string* pString) {
    int length = 0;
    int BATCH_SIZE = 256;
    char* data = (char*) malloc(sizeof(char) * BATCH_SIZE);
    while (length <= BATCH_SIZE * 4096) {
      BOOL success = readBuffer(hProcess, address + length, BATCH_SIZE, data);

      if (success == 0) {
        free(data);
        break;
      }

      for (const char* ptr = data; ptr - data < BATCH_SIZE; ++ptr) {
        if (*ptr == '\0') {
          length += ptr - data + 1;

          char* buffer = (char*) malloc(length);
          readBuffer(hProcess, address, length, buffer);

          *pString = std::string(buffer);

          free(data);
          free(buffer);

          return TRUE;
        }
      }

      length += BATCH_SIZE;
    }

    return FALSE;
  }

  // Every writeMemory overload below returns whether WriteProcessMemory both
  // succeeded AND wrote the full requested byte count (a short write is
  // treated as failure, not partial success), and reports the Win32 error
  // code via lastError when it did not. Callers must check the return value
  // — a discarded result here is exactly the defect this rework closes.
  template <class dataType>
  bool writeMemory(HANDLE hProcess, DWORD64 address, dataType value, DWORD* lastError = nullptr) {
    SIZE_T bytesWritten = 0;
    BOOL ok = WriteProcessMemory(hProcess, (LPVOID)address, &value, sizeof(dataType), &bytesWritten);
    bool success = ok && bytesWritten == sizeof(dataType);
    if (lastError) *lastError = success ? 0 : GetLastError();
    return success;
  }

  template <class dataType>
  bool writeMemory(HANDLE hProcess, DWORD64 address, dataType value, SIZE_T size, DWORD* lastError = nullptr) {
	  LPVOID buffer = value;

	  if (typeid(dataType) != typeid(char*)) {
		  buffer = &value;
	  }

	  SIZE_T bytesWritten = 0;
	  BOOL ok = WriteProcessMemory(hProcess, (LPVOID)address, buffer, size, &bytesWritten);
	  bool success = ok && bytesWritten == size;
	  if (lastError) *lastError = success ? 0 : GetLastError();
	  return success;
  }

  // Write String, Method 1: Utf8Value is converted to string, get pointer and length from string
  // template <>
  // void writeMemory<std::string>(HANDLE hProcess, DWORD address, std::string value) {
  //  WriteProcessMemory(hProcess, (LPVOID)address, value.c_str(), value.length(), NULL);
  // }

  // Write String, Method 2: get pointer and length from Utf8Value directly
  bool writeMemory(HANDLE hProcess, DWORD64 address, char* value, SIZE_T size, DWORD* lastError = nullptr) {
    SIZE_T bytesWritten = 0;
    BOOL ok = WriteProcessMemory(hProcess, (LPVOID)address, value, size, &bytesWritten);
    bool success = ok && bytesWritten == size;
    if (lastError) *lastError = success ? 0 : GetLastError();
    return success;
  }
};
#endif
#pragma once