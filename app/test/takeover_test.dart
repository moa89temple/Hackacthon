import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/widgets/buddy_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

/// A Connection's own screen, which is where its login is.
Future<void> openConnectionScreen(WidgetTester tester, {String name = 'Canvas'}) async {
  await openYouRow(tester, 'Connections');
  await openRow(tester, name);
}

Future<void> openCanvas(WidgetTester tester, FakeBackend backend) async {
  // The Read Permission comes first, so that's the only way to the button.
  backend.connections = [canvasConnection(on: true)];
  await openUnlockedApp(tester, backend);
  await openConnectionScreen(tester);
}

Future<void> tapThrough(WidgetTester tester, String words) async {
  await tester.ensureVisible(find.text(words));
  await tester.pumpAndSettle();
  await tester.tap(find.text(words));
  await tester.pumpAndSettle();
}

Future<void> openLiveView(WidgetTester tester) => tapThrough(tester, 'Log in to Canvas');

void main() {
  group('starting a Takeover', () {
    testWidgets('opens the live view with the headers the backend client gave', (tester) async {
      final seen = <Map<String, String>>[];
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true)]
        ..takeoverToStart = Takeover(
          site: 'canvas',
          siteName: 'Canvas',
          liveViewUrl: canvasTakeover.liveViewUrl,
          liveViewHeaders: const {'authorization': 'Bearer the-key'},
        );
      await tester.pumpWidget(
        testApp(
          store: FakeDeviceStore(testDevice),
          lock: FakeAppLock(),
          access: FakeBackendAccess(backend),
          liveViewBuilder: (url, headers) {
            seen.add(headers);
            return Text('live view of $url');
          },
        ),
      );
      await settleApp(tester);
      await openConnectionScreen(tester);

      await openLiveView(tester);

      expect(seen.last, {'authorization': 'Bearer the-key'});
    });

    testWidgets('opens a full-screen live view through the address the backend gave', (tester) async {
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);

      await openLiveView(tester);

      expect(backend.startedSites, ['canvas']);
      expect(find.text('live view of ${canvasTakeover.liveViewUrl}'), findsOneWidget);
      expect(find.text("You're in control. Buddy can't see this screen."), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Done'), findsOneWidget);
      expect(find.byType(BuddyNavBar), findsNothing);
    });

    testWidgets("explains when Buddy's Browser is not running", (tester) async {
      final backend = FakeBackend()..startTakeoverError = const BackendException('503');
      await openCanvas(tester, backend);

      await openLiveView(tester);

      expect(find.textContaining("couldn't open its browser"), findsOneWidget);
      expect(find.text('Log in to Canvas'), findsOneWidget);
    });

    testWidgets("names the other Connection's Takeover when that's what's in the way, not the browser", (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true), canvasConnection(id: 'navigate360', name: 'Navigate360', on: true)]
        ..takeoverUnderWay = canvasTakeover
        ..startTakeoverError = const BackendException('409');
      await openUnlockedApp(tester, backend);
      await openConnectionScreen(tester, name: 'Navigate360');

      await tapThrough(tester, 'Log in to Navigate360');

      expect(find.textContaining('tap Continue logging in to Canvas, then Done'), findsOneWidget);
      expect(find.textContaining("couldn't open its browser"), findsNothing);
    });

    testWidgets("says the Takeover's still open when the Student leaves without tapping Done", (tester) async {
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);
      await openLiveView(tester);
      backend.takeoverUnderWay = canvasTakeover;

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(find.textContaining("You're still in control of Buddy's Browser for Canvas"), findsOneWidget);
    });

    testWidgets("says which Takeover is in the way when Read now can't read", (tester) async {
      final backend = FakeBackend()
        ..takeoverUnderWay = canvasTakeover
        ..connectionAfterRead = canvasConnection(on: true, problem: 'A Takeover is open.');
      await openCanvas(tester, backend);

      await tapThrough(tester, 'Read now');

      expect(find.textContaining('tap Continue logging in to Canvas, then Done'), findsOneWidget);
    });

    testWidgets('offers to continue when a Takeover is already under way', (tester) async {
      final backend = FakeBackend()
        ..takeoverUnderWay = canvasTakeover
        ..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);

      await tester.tap(find.text('Continue logging in to Canvas'));
      await tester.pumpAndSettle();

      expect(find.text('live view of ${canvasTakeover.liveViewUrl}'), findsOneWidget);
    });
  });

  group('tapping Done', () {
    testWidgets('hands control back and says the Student is logged in', (tester) async {
      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: true, title: 'Dashboard');
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(backend.finishCount, 1);
      expect(find.textContaining('live view of'), findsNothing);
      expect(find.text('You\'re logged in to Canvas. Buddy opened "Dashboard" to check.'), findsOneWidget);

      // The live view took the whole screen, and the rest of the app is still there behind it.
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(BuddyNavBar), findsOneWidget);
    });

    testWidgets('says so when Buddy could not confirm the login', (tester) async {
      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: false);
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(find.textContaining("Buddy couldn't confirm you're logged in to Canvas"), findsOneWidget);
      expect(find.text('Log in to Canvas'), findsOneWidget);
    });

    testWidgets('stays on the live view and allows a retry when the backend cannot be reached', (tester) async {
      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finishError = const BackendException('offline');
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(find.textContaining('live view of'), findsOneWidget);
      expect(find.textContaining("couldn't reach Buddy"), findsOneWidget);
      // The Takeover may have ended even though the answer never arrived.
      expect(find.textContaining('still in control'), findsNothing);

      backend
        ..finishError = null
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: true, title: 'Dashboard');
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(find.textContaining('live view of'), findsNothing);
      expect(find.textContaining("You're logged in to Canvas"), findsOneWidget);
    });

    testWidgets('closes the live view when the Takeover had already ended', (tester) async {
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(find.textContaining('live view of'), findsNothing);
      expect(find.text('Log in to Canvas'), findsOneWidget);
    });

    testWidgets('can only be tapped once while it is working', (tester) async {
      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: true, title: 'Dashboard')
        ..holdFinish = true;
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pump();
      await tester.tap(find.byType(FilledButton), warnIfMissed: false);
      await tester.pump();

      expect(backend.finishCount, 1);
      backend.releaseFinish();
      await tester.pumpAndSettle();
    });
  });

  group('leaving without tapping Done', () {
    testWidgets('leaves the Takeover under way, so Buddy stays out and the Student can return', (tester) async {
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);
      await openLiveView(tester);
      backend.takeoverUnderWay = canvasTakeover;

      await tester.pageBack();
      await tester.pumpAndSettle();

      expect(backend.finishCount, 0);
      expect(find.text('Continue logging in to Canvas'), findsOneWidget);
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears who is in control, the live view and Done', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);
      await openLiveView(tester);

      final control = find.bySemanticsLabel("You're in control. Buddy can't see this screen.");
      expect(tester.getSemantics(control).flagsCollection.isLiveRegion, isTrue);
      expect(find.bySemanticsLabel(RegExp("Live view of Buddy's Browser")), findsOneWidget);
      expect(find.bySemanticsLabel('Done'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the result of Done is announced', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: true, title: 'Dashboard');
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      final result = find.bySemanticsLabel(RegExp("You're logged in to Canvas"));
      expect(tester.getSemantics(result).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('the live view screen meets the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openCanvas(tester, backend);
      await openLiveView(tester);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('the way to a login and the live view screen fit at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finishError = const BackendException('offline');
      backend.connections = [canvasConnection(on: true)];
      await openUnlockedApp(tester, backend);
      await goToTab(tester, 'You');
      await settleApp(tester);
      expect(tester.takeException(), isNull, reason: 'overflow on the You tab');

      await openYouRow(tester, 'Connections');
      expect(tester.takeException(), isNull, reason: 'overflow on the list of Connections');

      await tester.scrollUntilVisible(find.text('Canvas'), 200, scrollable: find.byType(Scrollable).first);
      await tester.pump();
      await openRow(tester, 'Canvas');
      expect(tester.takeException(), isNull, reason: "overflow on the Connection's own screen");

      await openLiveView(tester);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'overflow on the live view screen');
      expect(find.text('Done').hitTestable(), findsOneWidget);
    });
  });
}
