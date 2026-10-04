// OISSchoolBell.cs - "OIS School Bell" boshqaruv panelining alohida dasturi (Edge/brauzersiz oyna).
// Ichida Windows'ning o'rnatilgan WebView2 komponenti ishlaydi (yangi Outlook va Teams ham shunda ishlaydi).
// Dastur faqat oyna: qo'ng'iroqlar alohida (bell_scheduler.py) chalinadi - oyna yopilsa ham to'xtamaydi.
//
// Yig'ish: installer/build_app.ps1 (.NET Framework'dagi csc.exe bilan, qo'shimcha dastur kerak emas)
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace OISSchoolBell
{
    static class Program
    {
        const string PanelUrl = "http://localhost:3000/";
        const string AppId = "OIS.SchoolBell.Panel";
        const string WindowTitle = "OIS School Bell";

        [DllImport("shell32.dll", SetLastError = true)]
        static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string appId);
        [DllImport("user32.dll")] static extern IntPtr FindWindow(string cls, string title);
        [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int cmd);
        [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);

        public static string AppDir { get { return AppDomain.CurrentDomain.BaseDirectory; } }

        [STAThread]
        static void Main()
        {
            // Bitta nusxa: dastur allaqachon ochiq bo'lsa - o'sha oynani oldinga chiqaramiz
            bool created;
            using (var mutex = new Mutex(true, "Local\\" + AppId, out created))
            {
                if (!created)
                {
                    IntPtr h = FindWindow(null, WindowTitle);
                    if (h != IntPtr.Zero)
                    {
                        if (IsIconic(h)) ShowWindow(h, 9); // SW_RESTORE
                        SetForegroundWindow(h);
                    }
                    return;
                }
                try { SetCurrentProcessExplicitAppUserModelID(AppId); } catch { }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm(PanelUrl, WindowTitle));
            }
        }

        // Panel serveri (bell_web/server.js) javob beryaptimi
        public static bool PanelUp(string url)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url + "api/config");
                req.Timeout = 1500;
                req.Proxy = null;
                using (var res = (HttpWebResponse)req.GetResponse()) return res.StatusCode == HttpStatusCode.OK;
            }
            catch { return false; }
        }

        // Server ishlamayotgan bo'lsa - ishga tushiramiz (start_panel.vbs) va 15 soniyagacha kutamiz
        public static bool EnsurePanel(string url)
        {
            if (PanelUp(url)) return true;
            string vbs = Path.Combine(AppDir, "start_panel.vbs");
            if (File.Exists(vbs))
            {
                try
                {
                    Process.Start(new ProcessStartInfo("wscript.exe", "\"" + vbs + "\"") { UseShellExecute = false, CreateNoWindow = true });
                }
                catch { }
            }
            for (int i = 0; i < 30; i++)
            {
                Thread.Sleep(500);
                if (PanelUp(url)) return true;
            }
            return false;
        }
    }

    class MainForm : Form
    {
        readonly string url;
        readonly WebView2 web = new WebView2();
        readonly Label status = new Label();

        public MainForm(string url, string title)
        {
            this.url = url;
            Text = title;
            StartPosition = FormStartPosition.CenterScreen;
            var area = Screen.PrimaryScreen.WorkingArea;
            Size = new Size(Math.Min(1280, area.Width - 40), Math.Min(880, area.Height - 40));
            MinimumSize = new Size(420, 500);
            BackColor = Color.FromArgb(17, 21, 20);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            status.Dock = DockStyle.Fill;
            status.TextAlign = ContentAlignment.MiddleCenter;
            status.ForeColor = Color.FromArgb(160, 170, 165);
            status.Font = new Font("Segoe UI", 11f);
            status.Text = "OIS School Bell ochilmoqda...";
            Controls.Add(status);

            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = BackColor;
            web.Visible = false;
            Controls.Add(web);

            Shown += async (s, e) => await StartAsync();
        }

        async Task StartAsync()
        {
            bool up = await Task.Run(() => Program.EnsurePanel(url));
            if (!up)
            {
                status.Text = "Boshqaruv paneli ishga tushmadi.\nKompyuterni qayta yoqib ko'ring yoki dasturni qayta o'rnating.";
                return;
            }
            try
            {
                string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OIS School Bell", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, data);
                await web.EnsureCoreWebView2Async(env);
            }
            catch (Exception)
            {
                // WebView2 komponenti yo'q (juda eski Windows) - oddiy brauzerda ochamiz
                MessageBox.Show(this,
                    "Bu kompyuterda Microsoft WebView2 komponenti topilmadi, panel brauzerda ochiladi.\n\n" +
                    "Uni o'rnatish uchun: https://go.microsoft.com/fwlink/p/?LinkId=2124703",
                    Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                try { Process.Start(url); } catch { }
                Close();
                return;
            }

            var core = web.CoreWebView2;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true; // F5, Ctrl+F va h.k.
            // Panel ichidagi tashqi havolalar (masalan, onlayn panel manzili) - odatdagi brauzerda ochiladi
            core.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                OpenExternal(e.Uri);
            };
            core.NavigationStarting += (s, e) =>
            {
                if (!e.Uri.StartsWith(url, StringComparison.OrdinalIgnoreCase) && !e.Uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
                {
                    e.Cancel = true;
                    OpenExternal(e.Uri);
                }
            };
            // Panel shu kompyuterning o'zidan ochiladi - mikrofon so'rovi uchun oyna chiqarmaymiz
            core.PermissionRequested += (s, e) =>
            {
                if (e.Uri.StartsWith(url, StringComparison.OrdinalIgnoreCase) && e.PermissionKind == CoreWebView2PermissionKind.Microphone)
                    e.State = CoreWebView2PermissionState.Allow;
            };
            web.Visible = true;
            status.Visible = false;
            web.Source = new Uri(url);
        }

        // Windows qorong'i mavzuda bo'lsa - oyna sarlavhasi ham qorong'i (panel bilan bir xil ko'rinishi uchun)
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try
            {
                object v = Microsoft.Win32.Registry.GetValue(
                    @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1);
                int dark = (v is int && (int)v == 0) ? 1 : 0;
                if (dark == 1) DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)); // DWMWA_USE_IMMERSIVE_DARK_MODE
            }
            catch { }
        }

        static void OpenExternal(string uri)
        {
            if (uri != null && (uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase)))
            {
                try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
            }
        }
    }
}
