// Steam 灯塔 · 桌面客户端（独立窗口版）
// 内嵌静态站在本地起服务，然后用 Edge/Chrome 的 app 模式开一个无地址栏、无标签页的独立窗口。
// 关掉那个窗口 → 服务停止 → 进程退出。不依赖 Node、不需要管理员权限。
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace SteamLighthouse
{
    internal static class Program
    {
        internal static string SiteDir;
        internal static int Port;
        internal static string BaseUrl;
        internal static string DataRoot;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                DataRoot = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SteamLighthouse");
                Directory.CreateDirectory(DataRoot);

                SiteDir = ExtractSite();
                Port = FindFreePort(8765);
                BaseUrl = "http://127.0.0.1:" + Port + "/";
                StartServer(SiteDir, Port);

                string browser = FindBrowser();
                if (browser == null)
                {
                    // 没有 Edge/Chrome 就退回默认浏览器
                    Process.Start(BaseUrl);
                    Application.Run(new FallbackForm());
                    return;
                }

                string profile = Path.Combine(DataRoot, "profile");
                Directory.CreateDirectory(profile);

                ProcessStartInfo psi = new ProcessStartInfo(browser);
                psi.Arguments =
                    "--app=" + BaseUrl +
                    " --window-size=1280,820" +
                    " --window-position=120,60" +
                    " --user-data-dir=\"" + profile + "\"" +
                    " --no-first-run --no-default-browser-check" +
                    " --disable-features=Translate,CalculateNativeWinOcclusion";
                psi.UseShellExecute = false;

                Process app = Process.Start(psi);
                if (app == null) throw new Exception("无法启动浏览器窗口");

                // 等窗口出现后收起来：主进程只做服务宿主，不显示自己的界面
                Application.Run(new HostForm(app));
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message, "Steam 灯塔", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string FindBrowser()
        {
            string[] candidates = new string[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };
            foreach (string c in candidates) if (File.Exists(c)) return c;
            return null;
        }

        private static string ExtractSite()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            Stream zipStream = asm.GetManifestResourceStream("site.zip");
            if (zipStream == null) throw new Exception("客户端资源缺失（site.zip 没有打包进来）");

            long len = zipStream.Length;
            string dir = Path.Combine(DataRoot, "site-" + len.ToString());
            string marker = Path.Combine(dir, ".ready");

            if (!File.Exists(marker))
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                Directory.CreateDirectory(dir);
                string tmpZip = Path.Combine(DataRoot, "site.zip");
                using (FileStream fs = File.Create(tmpZip))
                {
                    byte[] buf = new byte[81920];
                    int n;
                    while ((n = zipStream.Read(buf, 0, buf.Length)) > 0) fs.Write(buf, 0, n);
                }
                ZipFile.ExtractToDirectory(tmpZip, dir);
                File.WriteAllText(marker, DateTime.Now.ToString("s"));
                try { File.Delete(tmpZip); } catch { }
            }
            return dir;
        }

        private static int FindFreePort(int start)
        {
            for (int p = start; p < start + 200; p++)
            {
                try
                {
                    TcpListener probe = new TcpListener(IPAddress.Loopback, p);
                    probe.Start(); probe.Stop(); return p;
                }
                catch { }
            }
            throw new Exception("找不到可用端口");
        }

        private static void StartServer(string root, int port)
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, port);
            listener.Start(64);
            Thread t = new Thread(delegate()
            {
                while (true)
                {
                    TcpClient client = null;
                    try
                    {
                        client = listener.AcceptTcpClient();
                        ThreadPool.QueueUserWorkItem(HandleClient, client);
                    }
                    catch { if (client != null) client.Close(); }
                }
            });
            t.IsBackground = true;
            t.Start();
        }

        private static void HandleClient(object state)
        {
            TcpClient client = (TcpClient)state;
            try
            {
                client.ReceiveTimeout = 8000;
                using (NetworkStream ns = client.GetStream())
                {
                    StreamReader reader = new StreamReader(ns, Encoding.ASCII, false, 1024, true);
                    string requestLine = reader.ReadLine();
                    if (string.IsNullOrEmpty(requestLine)) return;
                    while (true)
                    {
                        string h = reader.ReadLine();
                        if (string.IsNullOrEmpty(h)) break;
                    }

                    string[] parts = requestLine.Split(' ');
                    string rawPath = parts.Length > 1 ? parts[1] : "/";
                    int q = rawPath.IndexOf('?');
                    if (q >= 0) rawPath = rawPath.Substring(0, q);
                    rawPath = Uri.UnescapeDataString(rawPath);
                    if (rawPath.EndsWith("/")) rawPath += "index.html";

                    string rel = rawPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
                    string full = Path.GetFullPath(Path.Combine(SiteDir, rel));
                    if (!full.StartsWith(Path.GetFullPath(SiteDir), StringComparison.OrdinalIgnoreCase))
                    {
                        WriteResponse(ns, 403, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("403"));
                        return;
                    }
                    if (!File.Exists(full)) full = Path.Combine(SiteDir, "index.html");

                    byte[] body = File.ReadAllBytes(full);
                    WriteResponse(ns, 200, MimeOf(Path.GetExtension(full)), body);
                }
            }
            catch { }
            finally { try { client.Close(); } catch { } }
        }

        private static void WriteResponse(NetworkStream ns, int code, string mime, byte[] body)
        {
            string head =
                "HTTP/1.1 " + code + " " + (code == 200 ? "OK" : "Error") + "\r\n" +
                "Content-Type: " + mime + "\r\n" +
                "Content-Length: " + body.Length + "\r\n" +
                "Cache-Control: no-cache\r\n" +
                "Connection: close\r\n\r\n";
            byte[] headBytes = Encoding.ASCII.GetBytes(head);
            ns.Write(headBytes, 0, headBytes.Length);
            ns.Write(body, 0, body.Length);
            ns.Flush();
        }

        private static string MimeOf(string ext)
        {
            switch ((ext ?? "").ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".jpg":
                case ".jpeg": return "image/jpeg";
                case ".png": return "image/png";
                case ".svg": return "image/svg+xml";
                case ".ico": return "image/x-icon";
                case ".txt": return "text/plain; charset=utf-8";
                case ".woff2": return "font/woff2";
                default: return "application/octet-stream";
            }
        }
    }

    /// 无界面宿主：应用窗口关闭后结束进程
    internal class HostForm : Form
    {
        private readonly Process _app;
        private readonly System.Windows.Forms.Timer _timer;

        public HostForm(Process app)
        {
            _app = app;
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            Opacity = 0;
            FormBorderStyle = FormBorderStyle.None;
            Size = new Size(1, 1);
            Load += delegate { Hide(); };

            _timer = new System.Windows.Forms.Timer();
            _timer.Interval = 1000;
            _timer.Tick += delegate
            {
                try
                {
                    if (_app.HasExited) { _timer.Stop(); Application.Exit(); }
                }
                catch { _timer.Stop(); Application.Exit(); }
            };
            _timer.Start();
        }
    }

    /// 找不到 Edge/Chrome 时的兜底窗口
    internal class FallbackForm : Form
    {
        public FallbackForm()
        {
            Text = "Steam 灯塔";
            ClientSize = new Size(560, 200);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(10, 17, 26);
            ForeColor = Color.FromArgb(233, 241, 250);
            Font = new Font("Microsoft YaHei UI", 9f);

            Label t = new Label();
            t.Text = "已用默认浏览器打开 Steam 灯塔";
            t.Font = new Font("Microsoft YaHei UI", 12f, FontStyle.Bold);
            t.ForeColor = Color.FromArgb(102, 192, 244);
            t.SetBounds(24, 24, 500, 30);
            Controls.Add(t);

            TextBox url = new TextBox();
            url.Text = Program.BaseUrl;
            url.ReadOnly = true;
            url.SetBounds(24, 70, 380, 26);
            url.BackColor = Color.FromArgb(18, 28, 40);
            url.ForeColor = Color.FromArgb(233, 241, 250);
            Controls.Add(url);

            Button open = new Button();
            open.Text = "重新打开";
            open.SetBounds(414, 69, 110, 28);
            open.FlatStyle = FlatStyle.Flat;
            open.Click += delegate { Process.Start(Program.BaseUrl); };
            Controls.Add(open);

            Label tip = new Label();
            tip.Text = "关闭此窗口即退出服务";
            tip.ForeColor = Color.FromArgb(120, 145, 170);
            tip.SetBounds(24, 120, 400, 20);
            Controls.Add(tip);
        }
    }
}
