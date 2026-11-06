// =============================================================================
// WilsonGatewayHost.exe: the Windows service host for both of the gateway's
// services (design §1, §8; the brief, item 5). Node cannot answer Windows'
// Service Control Manager itself, and the brief allows a native piece only
// where Windows requires one: this is that piece, ours, in this repository,
// compiled from source by the .NET Framework's own csc.exe (C# 5, present on
// every Windows 10 and 11), so no third-party binary ships.
//
//   WilsonGatewayHost.exe WilsonGateway         runs current\node.exe current\app\src\cli.mjs run
//   WilsonGatewayHost.exe WilsonGatewayUpdater  runs updater\node.exe updater\app\updater\updater.mjs
//
// Paths are fixed relative to the host's own folder (Program Files\WILSON
// Gateway\host\), never taken from the command line or the environment. The
// child gets WILSON_GATEWAY_SERVICE=1 and UV_THREADPOOL_SIZE=32 (a share that
// stalls holds a pool thread; BC2's lesson); its output goes to
// ProgramData\WILSON Gateway\logs\<service>.log (five files of 5 MB kept).
// Stop: the child's stdin is closed (the gateway closes its doors and flushes
// its journal), 20 s, then it is killed. A child that dies on its own takes
// the host with it, so the service's recovery actions restart it.
// =============================================================================

using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;
using System.Text;

namespace Wilson.Gateway
{
    public sealed class Host : ServiceBase
    {
        private readonly object gate = new object();
        private Process child;
        private StreamWriter log;
        private string logPath;
        private volatile bool stopping;

        public Host(string name)
        {
            ServiceName = name;
            CanStop = true;
            CanShutdown = true;
            AutoLog = false;
        }

        private static string InstallDir()
        {
            return Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        }

        private static string Quote(string s)
        {
            return "\"" + s.Replace("\"", "\\\"") + "\"";
        }

        private void Write(string line)
        {
            if (line == null) return;
            lock (gate)
            {
                try
                {
                    if (log == null) return;
                    log.WriteLine(line);
                    log.Flush();
                    if (log.BaseStream.Length > 5 * 1024 * 1024) Rotate();
                }
                catch (Exception) { }
            }
        }

        private void Rotate()
        {
            log.Dispose();
            for (int i = 4; i >= 1; i--)
            {
                string from = logPath + "." + i;
                string to = logPath + "." + (i + 1);
                if (File.Exists(to)) File.Delete(to);
                if (File.Exists(from)) File.Move(from, to);
            }
            if (File.Exists(logPath + ".1")) File.Delete(logPath + ".1");
            File.Move(logPath, logPath + ".1");
            log = new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.Read), new UTF8Encoding(false));
        }

        protected override void OnStart(string[] args)
        {
            string install = InstallDir();
            string node;
            string arguments;
            if (ServiceName == "WilsonGateway")
            {
                node = Path.Combine(install, "current", "node.exe");
                arguments = Quote(Path.Combine(install, "current", "app", "src", "cli.mjs")) + " run";
            }
            else if (ServiceName == "WilsonGatewayUpdater")
            {
                node = Path.Combine(install, "updater", "node.exe");
                arguments = Quote(Path.Combine(install, "updater", "app", "updater", "updater.mjs"));
            }
            else
            {
                throw new InvalidOperationException("WilsonGatewayHost runs WilsonGateway or WilsonGatewayUpdater, not " + ServiceName);
            }

            string logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "WILSON Gateway", "logs");
            Directory.CreateDirectory(logDir);
            logPath = Path.Combine(logDir, ServiceName + ".log");
            log = new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.Read), new UTF8Encoding(false));
            Write(DateTime.UtcNow.ToString("o") + " host starting " + ServiceName);

            ProcessStartInfo psi = new ProcessStartInfo(node, arguments);
            psi.UseShellExecute = false;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = install;
            psi.EnvironmentVariables["WILSON_GATEWAY_SERVICE"] = "1";
            psi.EnvironmentVariables["UV_THREADPOOL_SIZE"] = "32";
            psi.EnvironmentVariables.Remove("NODE_OPTIONS");
            psi.EnvironmentVariables.Remove("NODE_EXTRA_CA_CERTS");
            psi.EnvironmentVariables.Remove("WILSON_GATEWAY_STATE_DIR");

            child = new Process();
            child.StartInfo = psi;
            child.EnableRaisingEvents = true;
            child.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { Write(e.Data); };
            child.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { Write(e.Data); };
            child.Exited += delegate (object s, EventArgs e)
            {
                if (stopping) return;
                Write(DateTime.UtcNow.ToString("o") + " host: the child exited on its own (" + child.ExitCode + "); the service stops so its recovery restarts it");
                Environment.Exit(1);
            };
            child.Start();
            child.BeginOutputReadLine();
            child.BeginErrorReadLine();
        }

        protected override void OnStop()
        {
            stopping = true;
            try { child.StandardInput.Close(); } catch (Exception) { }
            try
            {
                if (!child.WaitForExit(20000))
                {
                    Write(DateTime.UtcNow.ToString("o") + " host: the child did not stop within 20 s; killed");
                    child.Kill();
                }
            }
            catch (Exception) { }
            Write(DateTime.UtcNow.ToString("o") + " host stopped " + ServiceName);
            lock (gate) { try { log.Dispose(); } catch (Exception) { } log = null; }
        }

        protected override void OnShutdown()
        {
            OnStop();
        }

        public static int Main(string[] args)
        {
            if (args.Length != 1 || (args[0] != "WilsonGateway" && args[0] != "WilsonGatewayUpdater"))
            {
                Console.Error.WriteLine("WilsonGatewayHost.exe WilsonGateway | WilsonGatewayUpdater (run by the Service Control Manager)");
                return 2;
            }
            ServiceBase.Run(new Host(args[0]));
            return 0;
        }
    }
}
