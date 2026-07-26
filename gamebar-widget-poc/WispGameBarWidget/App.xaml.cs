using Microsoft.Gaming.XboxGameBar;
using System;
using Windows.ApplicationModel.Activation;
using Windows.UI.Xaml;
using Windows.UI.Xaml.Controls;
using Windows.UI.Xaml.Navigation;

namespace WispGameBarWidget
{
    /// <summary>
    /// Entry point for the Wisp Game Bar widget POC.
    ///
    /// Activation flow rebuilt against Microsoft's current documented pattern
    /// (learn.microsoft.com/en-us/xbox/game-bar/guide/app-activation, fetched
    /// during this rebuild) rather than a guessed API:
    ///
    /// - Game Bar activates the app via a Protocol activation with URI scheme
    ///   "ms-gamebarwidget", not a normal OnLaunched tile launch.
    /// - The args are cast to <see cref="XboxGameBarWidgetActivatedEventArgs"/>.
    /// - <see cref="XboxGameBarWidgetActivatedEventArgs.IsLaunchActivation"/>
    ///   MUST be checked: true means construct a new XboxGameBarWidget (first
    ///   activation for this widget instance); false means this is a repeat
    ///   activation (e.g. another widget sent this one a command) and a new
    ///   XboxGameBarWidget object must NOT be constructed.
    /// - XboxGameBarWidget's only real constructor is
    ///   (XboxGameBarWidgetActivatedEventArgs, CoreWindow, Frame) - there is no
    ///   static factory method. (Verified directly against the shipped
    ///   Microsoft.Gaming.XboxGameBar.winmd's public type/member list, not
    ///   assumed from a sample.)
    /// - The widget object must be held for the app's lifetime (an App-level
    ///   field), and MainPage reads it back via Application.Current rather
    ///   than a Frame.Navigate parameter, matching Microsoft's sample
    ///   structure.
    ///
    /// NOT covered by this POC (see ARCHITECTURE.md "explicit non-goals"):
    /// no process attach, no memory access, no trainer/injection logic of any
    /// kind. This file only wires up UI activation and a single mock HTTP
    /// call.
    /// </summary>
    public sealed partial class App : Application
    {
        public XboxGameBarWidget? Widget { get; private set; }

        public App()
        {
            InitializeComponent();
            Suspending += OnSuspending;
        }

        protected override void OnActivated(IActivatedEventArgs args)
        {
            if (args.Kind != ActivationKind.Protocol
                || args is not IProtocolActivatedEventArgs protocolArgs
                || !string.Equals(protocolArgs.Uri.Scheme, "ms-gamebarwidget", StringComparison.OrdinalIgnoreCase)
                || args is not XboxGameBarWidgetActivatedEventArgs widgetArgs)
            {
                base.OnActivated(args);
                return;
            }

            var rootFrame = new Frame();
            rootFrame.NavigationFailed += OnNavigationFailed;
            Window.Current.Content = rootFrame;

            if (widgetArgs.IsLaunchActivation)
            {
                // Must only construct XboxGameBarWidget on the initial launch
                // activation for this widget instance - never on a repeat
                // activation (see class-level doc comment above).
                Widget = new XboxGameBarWidget(widgetArgs, Window.Current.CoreWindow, rootFrame);
            }

            rootFrame.Navigate(typeof(MainPage));
            Window.Current.Activate();
        }

        /// <summary>
        /// Stock UWP launch path (e.g. F5 debugging outside Game Bar, or the
        /// app's Start-menu tile if AppListEntry isn't set to "none"). Not a
        /// Game Bar activation - shown so the POC is inspectable without a
        /// live Game Bar host, per ARCHITECTURE.md's testing notes.
        /// </summary>
        protected override void OnLaunched(LaunchActivatedEventArgs args)
        {
            var rootFrame = new Frame();
            rootFrame.NavigationFailed += OnNavigationFailed;
            Window.Current.Content = rootFrame;
            rootFrame.Navigate(typeof(MainPage));
            Window.Current.Activate();
        }

        private void OnNavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            throw new Exception($"Failed to load page '{e.SourcePageType.FullName}'.");
        }

        private void OnSuspending(object sender, Windows.ApplicationModel.SuspendingEventArgs e)
        {
            // Widget object cleanup is automatic when the last widget for this
            // app closes (see Microsoft's app-activation guide, "Repeated
            // Activations" section) - no explicit teardown needed here.
        }
    }
}
