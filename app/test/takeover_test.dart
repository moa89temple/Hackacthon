import 'package:buddy/app.dart';
import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';

final canvasTakeover = Takeover(
  site: 'canvas',
  siteName: 'Canvas',
  liveViewUrl: Uri.parse('http://backend.test/takeover/live/token/takeover.html'),
);

/// A real WebView can't run in a widget test, so this shows which address it would open.
Widget stubLiveView(Uri url) => Text('live view of $url');

Future<void> openYouTab(WidgetTester tester, FakeBackend backend) async {
  await tester.pumpWidget(BuddyApp(backend: backend, liveViewBuilder: stubLiveView));
  await tester.pump();
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
  await tester.pump();
}

Future<void> openLiveView(WidgetTester tester) async {
  await tester.tap(find.text('Log in to Canvas'));
  await tester.pumpAndSettle();
}

void main() {
  group('starting a Takeover', () {
    testWidgets('opens a full-screen live view through the address the backend gave', (tester) async {
      final backend = FakeBackend()..takeoverToStart = canvasTakeover;
      await openYouTab(tester, backend);

      await openLiveView(tester);

      expect(backend.startedSites, ['canvas']);
      expect(find.text('live view of ${canvasTakeover.liveViewUrl}'), findsOneWidget);
      expect(find.text("You're in control. Buddy can't see this screen."), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Done'), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
    });

    testWidgets("explains when Buddy's Browser is not running", (tester) async {
      final backend = FakeBackend()..startTakeoverError = const BackendException('503');
      await openYouTab(tester, backend);

      await openLiveView(tester);

      expect(find.textContaining("couldn't open its browser"), findsOneWidget);
      expect(find.text('Log in to Canvas'), findsOneWidget);
    });

    testWidgets('offers to continue when a Takeover is already under way', (tester) async {
      final backend = FakeBackend()
        ..takeoverUnderWay = canvasTakeover
        ..takeoverToStart = canvasTakeover;
      await openYouTab(tester, backend);

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
      await openYouTab(tester, backend);
      await openLiveView(tester);

      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(backend.finishCount, 1);
      expect(find.textContaining('live view of'), findsNothing);
      expect(find.text('You\'re logged in to Canvas. Buddy opened "Dashboard" to check.'), findsOneWidget);
      expect(find.byType(NavigationBar), findsOneWidget);
    });

    testWidgets('says so when Buddy could not confirm the login', (tester) async {
      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: false);
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
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
      await openYouTab(tester, backend);
      await openLiveView(tester);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('the You tab and the live view screen fit at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      final backend = FakeBackend()
        ..takeoverToStart = canvasTakeover
        ..finishError = const BackendException('offline');
      await openYouTab(tester, backend);
      expect(tester.takeException(), isNull, reason: 'overflow on the You tab');

      await openLiveView(tester);
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'overflow on the live view screen');
      expect(find.text('Done').hitTestable(), findsOneWidget);
    });
  });
}
