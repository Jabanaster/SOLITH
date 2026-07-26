using Microsoft.Gaming.XboxGameBar;
using System;
using System.Net.Http;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace WispGameBarWidget
{
    /// <summary>
    /// Wisp widget surface: static companion image, one clickable test
    /// button (hidden while click-through is active), and a mock localhost
    /// call to simulate talking to the real Solith desktop app.
    ///
    /// Click-through model corrected against Microsoft's actual docs
    /// (learn.microsoft.com/en-us/xbox/game-bar/guide/click-through, fetched
    /// during this rebuild): there is NO per-region/per-pixel hit-test API
    /// for Game Bar widgets. Click-through is a coarse, whole-widget toggle
    /// that Game Bar/the user controls via <see cref="XboxGameBarWidget.ClickThroughEnabled"/> -
    /// when it's true, ALL mouse input for this widget's window goes to the
    /// game underneath, with no exceptions. The documented pattern (see the
    /// guide's chat-widget example) is for the widget to hide or disable its
    /// own interactive controls while click-through is active, since the
    /// widget cannot receive input to those controls anyway in that state.
    /// The previous version of this file called a fabricated
    /// InputNonClientPointerSource/SetRegionRects API that does not exist for
    /// Game Bar widgets and would not have compiled.
    ///
    /// Explicit non-goals (see ARCHITECTURE.md and the task's scope
    /// constraint): no process attach, no memory read/write, no shell
    /// execution, no anti-detection/bypass logic, no trainer promotion or
    /// injection logic. This class only renders UI and makes one HTTP GET.
    /// </summary>
    public sealed partial class MainPage : Page
    {
        // Loopback-only mock endpoint (see ../mock-solith-service/server.py).
        // Never point this at a non-localhost host - it exists purely to
        // simulate the shape of a future real IPC channel between the widget
        // and the actual Solith Electron app.
        private const string MockSolithPingUrl = "http://127.0.0.1:8787/ping";

        private static readonly HttpClient HttpClient = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(2),
        };

        private XboxGameBarWidget? _widget;

        public MainPage()
        {
            InitializeComponent();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);

            // The widget is constructed once in App.OnActivated (only on the
            // initial launch activation) and held for the app's lifetime -
            // read it back from there rather than a navigation parameter, per
            // Microsoft's documented sample structure.
            _widget = (Windows.UI.Xaml.Application.Current as App)?.Widget;

            if (_widget != null)
            {
                _widget.ClickThroughEnabledChanged += (_, _) => UpdateControlPanelVisibility();
                UpdateControlPanelVisibility();
            }
        }

        /// <summary>
        /// Hides the only interactive control while click-through is active,
        /// per Microsoft's documented pattern - the button cannot receive
        /// input in that state (all input passes through to the game), so
        /// showing it would be misleading. The Wisp image itself has no
        /// interaction, so it stays visible unconditionally either way.
        /// </summary>
        private void UpdateControlPanelVisibility()
        {
            var clickThrough = _widget?.ClickThroughEnabled ?? false;
            ControlPanel.Visibility = clickThrough
                ? Windows.UI.Xaml.Visibility.Collapsed
                : Windows.UI.Xaml.Visibility.Visible;
        }

        private async void PingSolithButton_Click(object sender, Windows.UI.Xaml.RoutedEventArgs e)
        {
            StatusText.Text = "Contacting mock Solith service...";
            try
            {
                var response = await HttpClient.GetStringAsync(MockSolithPingUrl).ConfigureAwait(true);
                StatusText.Text = $"Solith mock replied: {response}";
            }
            catch (Exception ex)
            {
                StatusText.Text = $"Mock Solith service unreachable: {ex.Message}";
            }
        }
    }
}
