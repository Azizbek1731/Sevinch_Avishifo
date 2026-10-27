// Sevinch Avishifo — LAN client launcher for clinic staff PCs.
// Opens the clinic panel in Chrome/Edge app mode. Target: .NET Framework 4.x
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

namespace SevinchAvishifo
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            ServicePointManager.Expect100Continue = false;
            ServicePointManager.DefaultConnectionLimit = 4;

            var settings = AppSettings.Load();
            bool autoOpen = Array.Exists(args, a => string.Equals(a, "--open", StringComparison.OrdinalIgnoreCase));
            bool silentInstall = Array.Exists(args, a => string.Equals(a, "--install", StringComparison.OrdinalIgnoreCase));

            if (silentInstall)
            {
                ShortcutHelper.InstallAll(Application.ExecutablePath);
                return;
            }

            if (autoOpen)
            {
                string url;
                string err;
                if (Launcher.TryOpen(settings, out url, out err))
                    return;
                MessageBox.Show(
                    "Klinika serveriga ulanib bo‘lmadi.\n\n" + err,
                    "Sevinch Avishifo",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }

            Application.Run(new MainForm(settings));
        }
    }

    sealed class AppSettings
    {
        public string ServerIp = "192.168.1.110";
        public string PrimaryHost = "sevinch.local";
        public string ShortHost = "sevinch";
        public bool PreferHostName = true;
        public bool OpenInAppWindow = true;

        string PathFile
        {
            get
            {
                return Path.Combine(
                    Path.GetDirectoryName(Application.ExecutablePath) ?? AppDomain.CurrentDomain.BaseDirectory,
                    "SevinchAvishifo.ini");
            }
        }

        public static AppSettings Load()
        {
            var s = new AppSettings();
            try
            {
                if (!File.Exists(s.PathFile)) return s;
                foreach (var raw in File.ReadAllLines(s.PathFile, Encoding.UTF8))
                {
                    var line = raw.Trim();
                    if (line.Length == 0 || line.StartsWith("#") || line.StartsWith(";")) continue;
                    int eq = line.IndexOf('=');
                    if (eq <= 0) continue;
                    string key = line.Substring(0, eq).Trim().ToLowerInvariant();
                    string val = line.Substring(eq + 1).Trim();
                    if (key == "serverip") s.ServerIp = val;
                    else if (key == "primaryhost") s.PrimaryHost = val;
                    else if (key == "shorthost") s.ShortHost = val;
                    else if (key == "preferhostname") s.PreferHostName = val == "1" || val.Equals("true", StringComparison.OrdinalIgnoreCase);
                    else if (key == "openinappwindow") s.OpenInAppWindow = val == "1" || val.Equals("true", StringComparison.OrdinalIgnoreCase);
                }
            }
            catch { /* keep defaults */ }
            return s;
        }

        public void Save()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# Sevinch Avishifo — klient sozlamalari");
            sb.AppendLine("ServerIp=" + ServerIp);
            sb.AppendLine("PrimaryHost=" + PrimaryHost);
            sb.AppendLine("ShortHost=" + ShortHost);
            sb.AppendLine("PreferHostName=" + (PreferHostName ? "1" : "0"));
            sb.AppendLine("OpenInAppWindow=" + (OpenInAppWindow ? "1" : "0"));
            File.WriteAllText(PathFile, sb.ToString(), Encoding.UTF8);
        }

        public string[] CandidateUrls()
        {
            string ip = (ServerIp ?? "").Trim().TrimEnd('/');
            string host = (PrimaryHost ?? "").Trim().TrimEnd('/');
            string shortHost = (ShortHost ?? "").Trim().TrimEnd('/');

            if (PreferHostName)
            {
                return new[]
                {
                    "http://" + host + "/",
                    "http://" + shortHost + "/",
                    "http://" + ip + "/",
                };
            }
            return new[]
            {
                "http://" + ip + "/",
                "http://" + host + "/",
                "http://" + shortHost + "/",
            };
        }
    }

    static class Launcher
    {
        public static bool TryOpen(AppSettings settings, out string openedUrl, out string error)
        {
            openedUrl = null;
            error = null;
            string lastErr = null;
            foreach (var url in settings.CandidateUrls())
            {
                string probeErr;
                if (!IsReachable(url, out probeErr))
                {
                    lastErr = url + " — " + probeErr;
                    continue;
                }
                if (OpenBrowser(url, settings.OpenInAppWindow, out error))
                {
                    openedUrl = url;
                    return true;
                }
                lastErr = error;
            }
            error = lastErr ?? "Server topilmadi. IP va tarmoqni tekshiring.";
            return false;
        }

        public static bool IsReachable(string url, out string error)
        {
            error = null;
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = 4000;
                req.ReadWriteTimeout = 4000;
                req.AllowAutoRedirect = true;
                req.UserAgent = "SevinchAvishifoLauncher/1.0";
                using (var resp = (HttpWebResponse)req.GetResponse())
                {
                    int code = (int)resp.StatusCode;
                    if (code >= 200 && code < 500) return true;
                    error = "HTTP " + code;
                    return false;
                }
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        public static bool OpenBrowser(string url, bool appMode, out string error)
        {
            error = null;
            try
            {
                string browser = FindBrowser();
                if (browser != null && appMode)
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = browser,
                        Arguments = "--app=" + Quote(url) + " --new-window",
                        UseShellExecute = false,
                    };
                    Process.Start(psi);
                    return true;
                }

                Process.Start(new ProcessStartInfo
                {
                    FileName = url,
                    UseShellExecute = true,
                });
                return true;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return false;
            }
        }

        static string Quote(string s)
        {
            if (s.IndexOf(' ') >= 0) return "\"" + s + "\"";
            return s;
        }

        public static string FindBrowser()
        {
            string[] paths =
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe"),
            };
            foreach (var p in paths)
                if (File.Exists(p)) return p;

            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    var v = key != null ? key.GetValue(null) as string : null;
                    if (!string.IsNullOrEmpty(v) && File.Exists(v)) return v;
                }
                using (var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
                {
                    var v = key != null ? key.GetValue(null) as string : null;
                    if (!string.IsNullOrEmpty(v) && File.Exists(v)) return v;
                }
            }
            catch { }
            return null;
        }
    }

    static class ShortcutHelper
    {
        public static string InstallDir
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SevinchAvishifo");
            }
        }

        public static string InstallCopy(string sourceExe)
        {
            Directory.CreateDirectory(InstallDir);
            string target = Path.Combine(InstallDir, "SevinchAvishifo.exe");
            File.Copy(sourceExe, target, true);
            string iniSrc = Path.Combine(Path.GetDirectoryName(sourceExe) ?? "", "SevinchAvishifo.ini");
            string iniDst = Path.Combine(InstallDir, "SevinchAvishifo.ini");
            if (File.Exists(iniSrc))
                File.Copy(iniSrc, iniDst, true);
            else if (!File.Exists(iniDst))
                new AppSettings().SaveTo(iniDst);
            return target;
        }

        public static void InstallAll(string sourceExe)
        {
            string exe = InstallCopy(sourceExe);
            CreateShortcut(
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Sevinch Avishifo.lnk"),
                exe,
                "--open",
                "Sevinch Avishifo — klinika paneli");
            string startDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                "Programs",
                "Sevinch Avishifo");
            Directory.CreateDirectory(startDir);
            CreateShortcut(
                Path.Combine(startDir, "Sevinch Avishifo.lnk"),
                exe,
                "--open",
                "Sevinch Avishifo — klinika paneli");
            CreateShortcut(
                Path.Combine(startDir, "Sozlamalar.lnk"),
                exe,
                "",
                "Sevinch Avishifo sozlamalari");
        }

        public static void CreateShortcut(string lnkPath, string targetExe, string args, string description)
        {
            Type t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object shortcut = t.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath });
            Type st = shortcut.GetType();
            st.InvokeMember("TargetPath", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { targetExe });
            st.InvokeMember("Arguments", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { args ?? "" });
            st.InvokeMember("WorkingDirectory", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { Path.GetDirectoryName(targetExe) });
            st.InvokeMember("Description", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { description ?? "" });
            st.InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { targetExe + ",0" });
            st.InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, shortcut, null);
        }
    }

    // allow saving settings to an arbitrary path on first install
    static class AppSettingsPathExt
    {
        public static void SaveTo(this AppSettings s, string path)
        {
            var sb = new StringBuilder();
            sb.AppendLine("# Sevinch Avishifo — klient sozlamalari");
            sb.AppendLine("ServerIp=" + s.ServerIp);
            sb.AppendLine("PrimaryHost=" + s.PrimaryHost);
            sb.AppendLine("ShortHost=" + s.ShortHost);
            sb.AppendLine("PreferHostName=" + (s.PreferHostName ? "1" : "0"));
            sb.AppendLine("OpenInAppWindow=" + (s.OpenInAppWindow ? "1" : "0"));
            File.WriteAllText(path, sb.ToString(), Encoding.UTF8);
        }
    }

    sealed class MainForm : Form
    {
        readonly AppSettings settings;
        readonly TextBox ipBox;
        readonly Label statusLabel;
        readonly CheckBox appModeBox;
        readonly CheckBox preferHostBox;

        public MainForm(AppSettings settings)
        {
            this.settings = settings;
            Text = "Sevinch Avishifo";
            Width = 460;
            Height = 340;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.75f);
            BackColor = Color.White;

            var title = new Label
            {
                Text = "Sevinch Avishifo",
                Font = new Font("Segoe UI Semibold", 16f),
                AutoSize = true,
                Location = new Point(20, 18),
                ForeColor = Color.FromArgb(15, 76, 92),
            };
            var subtitle = new Label
            {
                Text = "Klinika tarmog‘idagi panelga tezkor kirish",
                AutoSize = true,
                Location = new Point(22, 52),
                ForeColor = Color.FromArgb(90, 90, 90),
            };

            var ipLabel = new Label { Text = "Server IP manzili:", Location = new Point(22, 92), AutoSize = true };
            ipBox = new TextBox
            {
                Text = settings.ServerIp,
                Location = new Point(22, 114),
                Width = 400,
            };

            preferHostBox = new CheckBox
            {
                Text = "Avval sevinch.local orqali urinish",
                Checked = settings.PreferHostName,
                Location = new Point(22, 148),
                AutoSize = true,
            };
            appModeBox = new CheckBox
            {
                Text = "Alohida dastur oynasida ochish (Chrome/Edge)",
                Checked = settings.OpenInAppWindow,
                Location = new Point(22, 172),
                AutoSize = true,
            };

            statusLabel = new Label
            {
                Text = "Tayyor.",
                Location = new Point(22, 204),
                Width = 400,
                Height = 36,
                ForeColor = Color.FromArgb(60, 60, 60),
            };

            var openBtn = new Button
            {
                Text = "Klinikaga kirish",
                Location = new Point(22, 250),
                Width = 160,
                Height = 36,
                BackColor = Color.FromArgb(15, 76, 92),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
            };
            openBtn.FlatAppearance.BorderSize = 0;
            openBtn.Click += (s, e) => OpenClinic();

            var installBtn = new Button
            {
                Text = "Ish stoliga o‘rnatish",
                Location = new Point(196, 250),
                Width = 150,
                Height = 36,
            };
            installBtn.Click += (s, e) => Install();

            var saveBtn = new Button
            {
                Text = "Saqlash",
                Location = new Point(356, 250),
                Width = 66,
                Height = 36,
            };
            saveBtn.Click += (s, e) => SaveSettings(true);

            Controls.Add(title);
            Controls.Add(subtitle);
            Controls.Add(ipLabel);
            Controls.Add(ipBox);
            Controls.Add(preferHostBox);
            Controls.Add(appModeBox);
            Controls.Add(statusLabel);
            Controls.Add(openBtn);
            Controls.Add(installBtn);
            Controls.Add(saveBtn);

            AcceptButton = openBtn;
            Shown += (s, e) => CheckStatusAsync();
        }

        void SaveSettings(bool toast)
        {
            settings.ServerIp = ipBox.Text.Trim();
            settings.PreferHostName = preferHostBox.Checked;
            settings.OpenInAppWindow = appModeBox.Checked;
            settings.Save();
            if (toast) statusLabel.Text = "Sozlamalar saqlandi.";
        }

        void OpenClinic()
        {
            SaveSettings(false);
            statusLabel.Text = "Ulanilmoqda…";
            statusLabel.Refresh();
            string url, err;
            if (Launcher.TryOpen(settings, out url, out err))
            {
                statusLabel.Text = "Ochildi: " + url;
                // Keep window for settings; user can close manually.
            }
            else
            {
                statusLabel.Text = "Xato: " + err;
                MessageBox.Show(
                    "Klinika serveriga ulanib bo‘lmadi.\n\n" + err +
                    "\n\nKompyuter klinika Wi‑Fi / LAN tarmog‘ida ekanini va server yoqilganini tekshiring.",
                    Text,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning);
            }
        }

        void Install()
        {
            try
            {
                SaveSettings(false);
                ShortcutHelper.InstallAll(Application.ExecutablePath);
                statusLabel.Text = "O‘rnatildi: ish stoli va Start menyu yorliqlari.";
                MessageBox.Show(
                    "Tayyor!\n\nIsh stolida «Sevinch Avishifo» yorlig‘i paydo bo‘ldi.\n" +
                    "Keyingi safar shu yorliq orqali to‘g‘ridan-to‘g‘ri panel ochiladi.",
                    Text,
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show("O‘rnatishda xato:\n" + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        void CheckStatusAsync()
        {
            statusLabel.Text = "Server tekshirilmoqda…";
            System.Threading.ThreadPool.QueueUserWorkItem(_ =>
            {
                string okUrl = null;
                string last = null;
                foreach (var url in settings.CandidateUrls())
                {
                    string err;
                    if (Launcher.IsReachable(url, out err))
                    {
                        okUrl = url;
                        break;
                    }
                    last = err;
                }
                BeginInvoke(new Action(() =>
                {
                    if (okUrl != null)
                        statusLabel.Text = "Server mavjud: " + okUrl;
                    else
                        statusLabel.Text = "Server topilmadi. Tarmoq / IP ni tekshiring. " + (last ?? "");
                }));
            });
        }
    }
}
