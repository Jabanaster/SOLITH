#pragma once
#ifndef PROCESS_H
#define PROCESS_H
#define WIN32_LEAN_AND_MEAN

#include <windows.h>
#include <TlHelp32.h>
#include <vector>

class process {
public:
  struct Pair {
    HANDLE handle;
    PROCESSENTRY32 process;
  };

  process();
  ~process();

  // requestWriteAccess: false (default) opens with the original
  // PROCESS_QUERY_INFORMATION | PROCESS_VM_READ rights only; true additionally
  // requests PROCESS_VM_WRITE | PROCESS_VM_OPERATION, the minimum extra rights
  // WriteProcessMemory needs. Never requests PROCESS_ALL_ACCESS.
  Pair openProcess(const char* processName, char** errorMessage, bool requestWriteAccess = false);
  Pair openProcess(DWORD processId, char** errorMessage, bool requestWriteAccess = false);
  void closeProcess(HANDLE hProcess);
  std::vector<PROCESSENTRY32> getProcesses(char** errorMessage);
};

#endif
#pragma once
