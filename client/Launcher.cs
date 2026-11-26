// Steam 灯塔 · 桌面客户端
// 把内置的静态站点释放到本地，用一个内嵌的极简 HTTP 服务托管，然后开浏览器。
// 不依赖 Node / 浏览器插件 / 管理员权限（用 TcpListener，不用 HttpListener，避开 URL ACL）。
using System;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Diagnostics;

namespace SteamLighthouse
{
    internal static class Program
    {
        internal static string SiteDir;
        internal static int Port;
        internal static string BaseUrl;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                SiteDir = ExtractSite();
                Port = FindFreePort(8765);
                BaseUrl = "http://127.0.0.1:" + Port + "/";
                StartServer(SiteDir, Port);
                Application.Run(new ClientForm());
            }
            catch (Exception ex)
            {
                MessageBox.Show("启动失败：" + ex.Message, "Steam 灯塔", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        // 把内嵌的 site.zip 解到 %LOCALAPPDATA%，按包长做版本号，升级后自动重解
        private static string ExtractSite()
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            Stream zipStream = asm.GetManifestResourceStream("site.zip");
            if (zipStream == null) throw new Exception("客户端资源缺失（site.zip 没有打包进来）");

            long len = zipStream.Length;
            string root = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "SteamLighthouse");
            string dir = Path.Combine(root, "site-" + len.ToString());
            string marker = Path.Combine(dir, ".ready");

            if (!File.Exists(marker))
            {
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                Directory.CreateDirectory(dir);
                string tmpZip = Path.Combine(root, "site.zip");
                Directory.CreateDirectory(root);
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
                    probe.Start();
                    probe.Stop();
                    return p;
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
                default: return "application/octet-stream";
            }
        }
    }

    internal class ClientForm : Form
    {
        private readonly TextBox _url;
        private readonly Label _status;

        public ClientForm()
        {
            Text = "Steam 灯塔";
            ClientSize = new Size(470, 210);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            BackColor = Color.FromArgb(10, 17, 26);
            ForeColor = Color.FromArgb(233, 241, 250);
            Font = new Font("Microsoft YaHei UI", 9f);

            Label title = new Label();
            title.Text = "Steam 灯塔";
            title.Font = new Font("Microsoft YaHei UI", 16f, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(102, 192, 244);
            title.SetBounds(22, 18, 220, 34);
            Controls.Add(title);

            Label sub = new Label();
            sub.Text = "本地服务已启动 · 关闭窗口即退出";
            sub.ForeColor = Color.FromArgb(139, 163, 187);
            sub.SetBounds(24, 54, 300, 20);
            Controls.Add(sub);

            _url = new TextBox();
            _url.Text = Program.BaseUrl;
            _url.ReadOnly = true;
            _url.SetBounds(24, 82, 300, 26);
            _url.BackColor = Color.FromArgb(18, 28, 40);
            _url.ForeColor = Color.FromArgb(233, 241, 250);
            _url.BorderStyle = BorderStyle.FixedSingle;
            Controls.Add(_url);

            Button open = new Button();
            open.Text = "打开网页";
            open.SetBounds(334, 80, 112, 30);
            open.BackColor = Color.FromArgb(126, 208, 255);
            open.ForeColor = Color.FromArgb(4, 33, 47);
            open.FlatStyle = FlatStyle.Flat;
            open.Click += delegate { Process.Start(Program.BaseUrl); };
            Controls.Add(open);

            Button copy = new Button();
            copy.Text = "复制链接";
            copy.SetBounds(24, 126, 96, 30);
            copy.FlatStyle = FlatStyle.Flat;
            copy.ForeColor = Color.FromArgb(200, 231, 251);
            copy.Click += delegate
            {
                try { Clipboard.SetText(Program.BaseUrl); _status.Text = "链接已复制"; }
                catch { _status.Text = "复制失败，请手动选中"; }
            };
            Controls.Add(copy);

            Button quit = new Button();
            quit.Text = "退出";
            quit.SetBounds(350, 126, 96, 30);
            quit.FlatStyle = FlatStyle.Flat;
            quit.ForeColor = Color.FromArgb(200, 231, 251);
            quit.Click += delegate { Close(); };
            Controls.Add(quit);

            _status = new Label();
            _status.Text = "数据日期见页脚 · make with ♥ love";
            _status.ForeColor = Color.FromArgb(94, 121, 148);
            _status.SetBounds(24, 170, 400, 20);
            Controls.Add(_status);

            Process.Start(Program.BaseUrl); // 启动就开浏览器
        }
    }
}
