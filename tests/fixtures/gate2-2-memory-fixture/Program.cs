// Gate 2.2 — dedicated, local, test-only memory fixture.
//
// Exposes exactly one fixed int32 sentinel value at a stable (pinned) address
// for the packaged SOLITH E2E harness to attach to, freeze, write, and
// verify against — a real OS process with a real, stable, writable address,
// standing in for a real single-player game process. This process:
//   - owns only its own fixed test value (one pinned Int32).
//   - exposes no arbitrary address/PID/command/path/memory interface: the
//     only channel out is a local status file containing this process's own
//     pid/address/value, written by itself, read-only from the outside.
//   - requires no elevation, modifies no host security policy, targets no
//     other process.
//   - shuts down cleanly on either a stop-file signal or being terminated by
//     its launlcher (the harness owns this process's lifecycle and is
//     authorized to terminate it directly).
//
// Usage: Gate2_2Fixture.exe <statusFilePath> <stopFilePath> [mutateFilePath]
//
// mutateFilePath (optional): if present, the fixture polls it each loop tick
// and — if it contains an integer — applies that value directly to its own
// pinned sentinel (simulating an external actor, e.g. game logic, changing
// the value independently of SOLITH), then deletes the file. This is the
// fixture's own controlled external-mutation mechanism for freeze-restore
// verification; it is not a general write channel (it only ever writes to
// this process's own single sentinel byte range).

if (args.Length < 2)
{
    Console.Error.WriteLine("usage: Gate2_2Fixture <statusFilePath> <stopFilePath> [mutateFilePath]");
    return 1;
}

string statusFilePath = args[0];
string stopFilePath = args[1];
string? mutateFilePath = args.Length >= 3 ? args[2] : null;

const int SentinelInitialValue = 424242;

byte[] sentinel = new byte[4];
System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(sentinel, SentinelInitialValue);

System.Runtime.InteropServices.GCHandle handle =
    System.Runtime.InteropServices.GCHandle.Alloc(sentinel, System.Runtime.InteropServices.GCHandleType.Pinned);

try
{
    IntPtr address = handle.AddrOfPinnedObject();
    int pid = Environment.ProcessId;

    while (true)
    {
        if (File.Exists(stopFilePath))
        {
            break;
        }

        if (mutateFilePath != null && File.Exists(mutateFilePath))
        {
            try
            {
                string mutateText = File.ReadAllText(mutateFilePath).Trim();
                if (int.TryParse(mutateText, out int mutateValue))
                {
                    System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(sentinel, mutateValue);
                }
                File.Delete(mutateFilePath);
            }
            catch (IOException)
            {
                // Best-effort: retry next tick.
            }
        }

        int currentValue = System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(sentinel);
        string statusJson =
            "{" +
            "\"pid\":" + pid + "," +
            "\"addressHex\":\"0x" + address.ToInt64().ToString("x") + "\"," +
            "\"value\":" + currentValue + "," +
            "\"updatedAtIso\":\"" + DateTime.UtcNow.ToString("o") + "\"" +
            "}";

        try
        {
            File.WriteAllText(statusFilePath, statusJson);
        }
        catch (IOException)
        {
            // Best-effort: a concurrent read from the harness may transiently
            // hold the file; skip this tick and retry next loop.
        }

        Thread.Sleep(100);
    }

    return 0;
}
finally
{
    handle.Free();
    try { File.Delete(statusFilePath); } catch { /* best-effort cleanup */ }
}
