import 'dart:async';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/device/app_lock.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

void main() {
  late FakeAppLock lock;
  late FakeBackend backend;

  setUp(() {
    lock = FakeAppLock();
    backend = FakeBackend(history: [const ChatMessage(isFromBuddy: true, text: 'A private reply')]);
  });

  Future<void> open(WidgetTester tester) async {
    await tester.pumpWidget(
      testApp(store: FakeDeviceStore(testDevice), lock: lock, access: FakeBackendAccess(backend)),
    );
    await settleApp(tester);
  }

  group('opening the app', () {
    testWidgets('asks for the fingerprint or face straight away', (tester) async {
      await open(tester);

      expect(lock.prompts, 1);
      expect(find.text('A private reply'), findsOneWidget);
    });

    testWidgets('shows and loads nothing until the Student is let in', (tester) async {
      lock.hold = Completer();
      await open(tester);

      expect(find.text('Buddy is locked'), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
      expect(backend.historyLoads, 0);

      lock.hold!.complete(UnlockResult.unlocked);
      await settleApp(tester);

      expect(find.byType(NavigationBar), findsOneWidget);
    });

    testWidgets('stays locked after a cancel, without asking again until the Student taps', (tester) async {
      lock.answers.add(UnlockResult.cancelled);
      await open(tester);

      expect(lock.prompts, 1);
      expect(find.text('A private reply'), findsNothing);

      await tester.tap(find.text('Unlock'));
      await settleApp(tester);

      expect(lock.prompts, 2);
      expect(find.text('A private reply'), findsOneWidget);
    });

    testWidgets('stays locked when the check fails, and says so', (tester) async {
      lock.answers.add(UnlockResult.failed);
      await open(tester);

      expect(find.textContaining("couldn't check"), findsOneWidget);
      expect(find.text('A private reply'), findsNothing);
    });

    testWidgets('stays locked on a phone with no screen lock, and says what to do', (tester) async {
      lock.answers.add(UnlockResult.noScreenLock);
      await open(tester);

      expect(find.textContaining('Set a screen lock'), findsOneWidget);
      expect(find.text('A private reply'), findsNothing);

      await tester.tap(find.text('Unlock'));
      await settleApp(tester);

      expect(find.text('A private reply'), findsOneWidget);
    });

    testWidgets('does not offer the button while the prompt is up', (tester) async {
      lock.hold = Completer();
      await open(tester);

      final button = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Unlock'));
      expect(button.onPressed, isNull);

      lock.hold!.complete(UnlockResult.cancelled);
      await settleApp(tester);
    });
  });

  group('going into the background', () {
    testWidgets('hides everything on the way out, and shows the lock on the way back', (tester) async {
      await open(tester);
      expect(find.text('A private reply'), findsOneWidget);

      await goToBackground(tester);
      expect(find.text('A private reply'), findsNothing);

      lock.hold = Completer();
      await comeBack(tester);
      expect(find.text('Buddy is locked'), findsOneWidget);
      expect(find.text('A private reply'), findsNothing);

      lock.hold!.complete(UnlockResult.unlocked);
      await settleApp(tester);
    });

    testWidgets('asks again on the way back, and returns to where the Student was', (tester) async {
      await open(tester);
      await tester.enterText(find.byType(TextField), 'half a thought');
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Today')));
      await tester.pump();

      await goToBackground(tester);
      await comeBack(tester);

      expect(lock.prompts, 2);
      expect(find.byType(NavigationBar), findsOneWidget);
      final selected = tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex;
      expect(selected, 1);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await tester.pump();
      expect(find.text('half a thought'), findsOneWidget);
    });

    testWidgets('stays locked on the way back if the Student cancels', (tester) async {
      await open(tester);
      lock.answers.add(UnlockResult.cancelled);

      await goToBackground(tester);
      await comeBack(tester);

      expect(find.text('Buddy is locked'), findsOneWidget);
      expect(find.text('A private reply'), findsNothing);
      expect(lock.prompts, 2);
    });

    testWidgets('only blanks the screen, without locking, for the notification shade', (tester) async {
      await open(tester);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await settleApp(tester);
      expect(find.text('A private reply'), findsNothing);
      expect(find.text('Buddy is locked'), findsNothing);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await settleApp(tester);

      expect(find.text('A private reply'), findsOneWidget);
      expect(lock.prompts, 1);
    });

    testWidgets("does not ask twice when the phone's own screen lock takes over from the prompt", (tester) async {
      lock.hold = Completer();
      await open(tester);

      // The PIN screen is its own activity, so the app goes into the background behind it.
      await goToBackground(tester);
      await comeBack(tester);
      expect(lock.prompts, 1);

      lock.hold!.complete(UnlockResult.unlocked);
      await settleApp(tester);

      expect(find.text('A private reply'), findsOneWidget);
      expect(lock.prompts, 1);
    });

    testWidgets('keeps a reply arriving behind the lock', (tester) async {
      await open(tester);
      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();

      await goToBackground(tester);
      backend.reply.add(const ReplyDone(ChatMessage(isFromBuddy: true, text: 'Finished while locked')));
      await backend.reply.close();
      await comeBack(tester);

      expect(find.text('Finished while locked'), findsOneWidget);
    });
  });

  group('during a Takeover', () {
    Future<void> openTakeover(WidgetTester tester) async {
      backend
        ..takeoverToStart = canvasTakeover
        ..connections = [canvasConnection(on: true)];
      await open(tester);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Log in to Canvas'));
      await tester.pumpAndSettle();
      expect(find.textContaining('live view of'), findsOneWidget);
    }

    testWidgets('the lock covers the live view', (tester) async {
      await openTakeover(tester);

      await goToBackground(tester);
      expect(find.textContaining('live view of'), findsNothing);

      lock.hold = Completer();
      await comeBack(tester);
      expect(find.text('Buddy is locked'), findsOneWidget);
      expect(find.textContaining('live view of'), findsNothing);
      expect(find.text('Done'), findsNothing);

      lock.hold!.complete(UnlockResult.unlocked);
      await settleApp(tester);
    });

    testWidgets('unlocking returns to the same live view, so Duo can be approved on the same phone', (tester) async {
      await openTakeover(tester);

      await goToBackground(tester);
      await comeBack(tester);

      expect(find.textContaining('live view of'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Done'), findsOneWidget);
    });
  });

  group('accessibility', () {
    testWidgets('meets the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      lock.answers.add(UnlockResult.noScreenLock);
      await open(tester);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('a screen reader hears why it stayed locked', (tester) async {
      final handle = tester.ensureSemantics();
      lock.answers.add(UnlockResult.noScreenLock);
      await open(tester);

      final note = find.ancestor(
        of: find.textContaining('Set a screen lock'),
        matching: find.byWidgetPredicate((widget) => widget is Semantics && widget.properties.liveRegion == true),
      );
      expect(note, findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader cannot reach what is behind the lock', (tester) async {
      final handle = tester.ensureSemantics();
      await open(tester);

      await goToBackground(tester);
      expect(find.bySemanticsLabel(RegExp('A private reply')), findsNothing);

      lock.hold = Completer();
      await comeBack(tester);
      expect(find.bySemanticsLabel(RegExp('A private reply')), findsNothing);

      lock.hold!.complete(UnlockResult.unlocked);
      await settleApp(tester);
      handle.dispose();
    });

    testWidgets('fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      lock.answers.add(UnlockResult.noScreenLock);

      await open(tester);

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Unlock'));
      await tester.pump();
      expect(find.widgetWithText(FilledButton, 'Unlock').hitTestable(), findsOneWidget);
    });
  });
}
