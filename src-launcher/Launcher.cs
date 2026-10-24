using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("RPA Video Editor")]
[assembly: AssemblyDescription("RPA Video Editor - Cleanroom Open-Source Studio Video Editing Suite")]
[assembly: AssemblyConfiguration("")]
[assembly: AssemblyCompany("K Vanlalrengpuia")]
[assembly: AssemblyProduct("RPA Video Editor")]
[assembly: AssemblyCopyright("Copyright (C) 2026 K Vanlalrengpuia")]
[assembly: AssemblyTrademark("Open Source (MIT License)")]
[assembly: AssemblyCulture("")]
[assembly: ComVisible(false)]
[assembly: AssemblyVersion("2.0.0.0")]
[assembly: AssemblyFileVersion("2.0.0.0")]

namespace RpaVideoEditor
{
    static class Program
    {
        private static Process serverProcess = null;

        [STAThread]
        static void Main(string[] args)
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string serverUrl = "http://127.0.0.1:3800";

            try
            {
                // 1. Check if server is already running
                bool serverRunning = IsServerOnline(serverUrl);
                if (!serverRunning)
                {
                    // Find Node executable
                    string nodeExe = FindNodeExecutable(appDir);
                    if (string.IsNullOrEmpty(nodeExe))
                    {
                        MessageBox.Show(
                            "Node.js runtime was not found.\nPlease ensure Node.js is installed or run the portable bundle.",
                            "RPA Video Editor - Runtime Missing",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Warning
                        );
                        return;
                    }

                    // Start background media server silently (no console window)
                    ProcessStartInfo srvInfo = new ProcessStartInfo();
                    srvInfo.FileName = nodeExe;
                    srvInfo.Arguments = "\"" + Path.Combine(appDir, "server", "server.js") + "\"";
                    srvInfo.WorkingDirectory = appDir;
                    srvInfo.CreateNoWindow = true;
                    srvInfo.UseShellExecute = false;
                    srvInfo.WindowStyle = ProcessWindowStyle.Hidden;
                    srvInfo.EnvironmentVariables["OFFLINE_DESKTOP"] = "1";

                    serverProcess = Process.Start(srvInfo);

                    // Wait up to 3 seconds for server to start listening
                    for (int i = 0; i < 30; i++)
                    {
                        Thread.Sleep(100);
                        if (IsServerOnline(serverUrl)) break;
                    }
                }

                // 2. Launch Dedicated Desktop Window (Edge App Mode - No Browser Tabs, No Address Bar)
                string edgeExe = FindEdgeExecutable();
                if (!string.IsNullOrEmpty(edgeExe))
                {
                    string profileDir = Path.Combine(appDir, ".rpa_desktop_profile");
                    ProcessStartInfo winInfo = new ProcessStartInfo();
                    winInfo.FileName = edgeExe;
                    winInfo.Arguments = "--app=\"" + serverUrl + "\" --window-size=1440,900 --user-data-dir=\"" + profileDir + "\"";
                    winInfo.WorkingDirectory = appDir;

                    Process appWindow = Process.Start(winInfo);
                    if (appWindow != null)
                    {
                        appWindow.WaitForExit();
                    }
                }
                else
                {
                    // Fallback to default launcher if Edge not present
                    Process.Start(serverUrl);
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error launching RPA Video Editor: " + ex.Message,
                    "RPA Video Editor Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                // Clean up background server process on exit
                if (serverProcess != null && !serverProcess.HasExited)
                {
                    try
                    {
                        serverProcess.Kill();
                    }
                    catch { }
                }
            }
        }

        private static bool IsServerOnline(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url + "/api/system/status");
                req.Timeout = 500;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        private static string FindNodeExecutable(string baseDir)
        {
            // Check local portable folder
            string localNode = Path.Combine(baseDir, "node.exe");
            if (File.Exists(localNode)) return localNode;

            localNode = Path.Combine(baseDir, "bin", "node.exe");
            if (File.Exists(localNode)) return localNode;

            // Check standard program files
            string pfNode = @"C:\Program Files\nodejs\node.exe";
            if (File.Exists(pfNode)) return pfNode;

            string pfNode86 = @"C:\Program Files (x86)\nodejs\node.exe";
            if (File.Exists(pfNode86)) return pfNode86;

            // Check PATH
            return "node";
        }

        private static string FindEdgeExecutable()
        {
            string[] possiblePaths = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe")
            };

            foreach (string p in possiblePaths)
            {
                if (File.Exists(p)) return p;
            }

            return null;
        }
    }
}
