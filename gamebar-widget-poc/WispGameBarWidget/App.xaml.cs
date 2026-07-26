using Microsoft.Xbox.Services.GameBar; // XboxGameBarWidget provider surface (package name approximate - see README).
using System;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;

namespace WispGameBarWidget
{
    /// <summary>
    /// Entry point for the Wisp Game Bar widget POC.
    ///
    /// A Game Bar widget is activated differently from a normal UWP app: Game
    /// Bar launches the package with an
    /// <see cref="XboxGameBarWidgetActivatedEventArgs"/> (a subtype of
    /// generic protocol/extension activation) instead of the usual
    /// "user double-clicked a tile" launch path. This override is the one
    /// piece of App-level plumbing that is specific to Game Bar widgets;
    /// everything else here is a stock UWP XAML app entry point.
    ///
    /// NOT covered by this POC (see ARCHITECTURE.md "explicit non-goals"):
    /// no process attach, no memory access, no trainer/injection logic of any
    /// kind. This file only wires up UI activation and a single mock HTTP
    /// call.
    /// </summary>
    public sealed partial class App : Application
    {
        private XboxGameBarWidget? _widget;
        private Window? _window;

        public App()
        {
            InitializeComponent();
        }

        protected override void OnActivated(IActivatedEventArgs args)
        {
            if (args is XboxGameBarWidgetActivatedEventArgs widgetArgs)
            {
                // XboxGameBarWidget.CreateAsync() is a documented static factory
                // (per Microsoft's XboxGameBarSamples) that establishes the IPC
                // channel back to Game Bar for this activation.
                _widget = XboxGameBarWidget.Create(widgetArgs);

                var rootFrame = new Windows.UI.Xaml.Controls.Frame();
                rootFrame.Navigate(typeof(MainPage), _widget);

                _window = Window.Current;
                _window.Content = rootFrame;
                _window.Activate();
            }
            else
            {
                base.OnActivated(args);
            }
        }
    }
}
