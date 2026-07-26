using Microsoft.Xbox.Services.GameBar;
using System;
using System.Net.Http;
using System.Threading.Tasks;
using Windows.Foundation;
using Windows.UI.Core;
using Windows.UI.Input;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace WispGameBarWidget
{
    /// <summary>
    /// Wisp widget surface: static companion image, one clickable test
    /// button, click-through everywhere else, and a mock localhost call to
    /// simulate talking to the real Solith desktop app.
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
            Loaded += MainPage_Loaded;
            SizeChanged += (_, _) => UpdateClickThroughRegions();
        }

        protected override void OnNavigatedTo(NavigationEventArgs e)
        {
            base.OnNavigatedTo(e);
            _widget = e.Parameter as XboxGameBarWidget;

            if (_widget != null)
            {
                // Fires when the user (or Game Bar's global toggle) changes
                // whether pinned widgets are click-through. We re-apply our
                // own per-control regions whenever that global state changes.
                _widget.ClickThroughEnabledChanged += (_, _) => UpdateClickThroughRegions();
            }
        }

        private void MainPage_Loaded(object sender, Windows.UI.Xaml.RoutedEventArgs e)
        {
            UpdateClickThroughRegions();
        }

        /// <summary>
        /// Marks the entire widget surface as click-through ("Passthrough")
        /// EXCEPT the rectangle occupied by <see cref="ControlPanel"/>, so
        /// the transparent area around the Wisp image never blocks input to
        /// the game underneath, while the button remains clickable.
        ///
        /// This uses the general UWP custom-hit-test-region API
        /// (InputNonClientPointerSource.SetRegionRects), which is the
        /// mechanism Microsoft's Game Bar "Supporting click-through" guide
        /// points widget authors at for per-widget, per-region input
        /// passthrough (distinct from Game Bar's older, coarser, all-widgets
        /// click-through toggle introduced in the SDK's May 2020 release).
        /// </summary>
        private void UpdateClickThroughRegions()
        {
            try
            {
                var windowBounds = Window_Bounds();
                if (windowBounds.Width <= 0 || windowBounds.Height <= 0)
                {
                    return;
                }

                var controlBounds = ElementBoundsInWindow(ControlPanel);

                var passthroughRects = SurroundingRects(windowBounds, controlBounds);

                var nonClientSource = InputNonClientPointerSource.GetForCurrentView();
                nonClientSource.SetRegionRects(NonClientRegionKind.Passthrough, passthroughRects);
            }
            catch (Exception ex)
            {
                // Best-effort: if the host Game Bar build does not support
                // per-region passthrough, the widget still works, it simply
                // will not click-through outside the control panel.
                System.Diagnostics.Debug.WriteLine($"[WispGameBarWidget] click-through setup failed: {ex}");
            }
        }

        private Rect Window_Bounds()
        {
            var bounds = Windows.UI.Xaml.Window.Current?.Bounds ?? default;
            return new Rect(0, 0, bounds.Width, bounds.Height);
        }

        private static Rect ElementBoundsInWindow(Windows.UI.Xaml.FrameworkElement element)
        {
            var transform = element.TransformToVisual(Windows.UI.Xaml.Window.Current.Content);
            var topLeft = transform.TransformPoint(new Windows.Foundation.Point(0, 0));
            return new Rect(topLeft.X, topLeft.Y, element.ActualWidth, element.ActualHeight);
        }

        /// <summary>
        /// Splits <paramref name="outer"/> into up to four non-overlapping
        /// rectangles that tile "outer minus inner" (top strip, bottom
        /// strip, and left/right strips beside inner's row).
        /// </summary>
        private static Rect[] SurroundingRects(Rect outer, Rect inner)
        {
            if (inner.Width <= 0 || inner.Height <= 0)
            {
                return new[] { outer };
            }

            var top = new Rect(outer.X, outer.Y, outer.Width, Math.Max(0, inner.Y - outer.Y));
            var bottomY = inner.Y + inner.Height;
            var bottom = new Rect(outer.X, bottomY, outer.Width, Math.Max(0, (outer.Y + outer.Height) - bottomY));
            var left = new Rect(outer.X, inner.Y, Math.Max(0, inner.X - outer.X), inner.Height);
            var rightX = inner.X + inner.Width;
            var right = new Rect(rightX, inner.Y, Math.Max(0, (outer.X + outer.Width) - rightX), inner.Height);

            return new[] { top, bottom, left, right };
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
