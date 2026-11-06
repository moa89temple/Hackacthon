import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/tasks/task_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

// Made-up Tasks and Connections, only ever in tests.
const _waitingTitle = 'Compare summer research programs';
const _workingTitle = 'Find internship Resources';

Task _waiting({int id = 2}) => Task(
      id: id,
      title: _waitingTitle,
      state: 'needs_student',
      stateText: 'Buddy needs you before it can go on.',
      needs: const ['Which program should Buddy look at first?'],
      canCancel: true,
    );

Task _working({int id = 1}) => Task(id: id, title: _workingTitle, state: 'working', stateText: 'Buddy is working on this.', canCancel: true);

Task _done({int id = 1}) => Task(id: id, title: _workingTitle, state: 'done', stateText: 'Done.', result: 'Buddy found four.');

void _useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _openMenu(WidgetTester tester) async {
  await tester.tap(find.byTooltip('Menu'));
  await tester.pumpAndSettle();
}

void main() {
  group("the conversation's header", () {
    testWidgets("shows Buddy's face and name in the middle, with the menu to its left", (tester) async {
      _useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend());

      expect(find.text('Buddy'), findsOneWidget);
      expect(find.text('Your Temple guide'), findsOneWidget);
      expect(tester.getCenter(find.text('Buddy')).dx, moreOrLessEquals(412 / 2, epsilon: 1));
      expect(tester.getCenter(find.byTooltip('Menu')).dx, lessThan(tester.getTopLeft(find.text('Buddy')).dx));
    });

    testWidgets("tapping Buddy's face opens Activity", (tester) async {
      _useOrdinaryPhone(tester);
      final backend = FakeBackend()..activity = [ActivityEntry(kind: 'connection_read', title: 'Buddy read Canvas', at: DateTime(2026, 11, 4, 7))];
      await openUnlockedApp(tester, backend);

      await tester.tap(find.text('Your Temple guide'));
      await tester.pumpAndSettle();

      expect(find.text('Activity'), findsOneWidget);
      expect(find.text('Buddy read Canvas'), findsOneWidget);
    });

    testWidgets('a screen reader hears who Buddy is, that it is a heading, and what tapping it does', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend());

      final who = find.bySemanticsLabel('Buddy, your Temple guide');
      expect(tester.getSemantics(who), isSemantics(isHeader: true, isButton: true, hasTapAction: true));
      expect(tester.getSemantics(who).hintOverrides?.onTapHint, 'see what Buddy read and did');
      handle.dispose();
    });

    testWidgets('puts the face beside the name with large text, so the conversation keeps its room', (tester) async {
      _useOrdinaryPhone(tester);
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('Hi')]));

      expect(tester.takeException(), isNull);
      expect(tester.getTopLeft(find.text('Buddy')).dy, lessThan(tester.getBottomLeft(find.byTooltip('Menu')).dy));
    });
  });

  group('the status pill', () {
    testWidgets("isn't there when nothing is under way or waiting", (tester) async {
      await openUnlockedApp(tester, FakeBackend()..tasks = [_done()]);

      expect(find.textContaining('Task needs you'), findsNothing);
      expect(find.textContaining('Task under way'), findsNothing);
      expect(find.textContaining('Login needed'), findsNothing);
    });

    testWidgets('shows a Task that needs the Student before anything else, and opens it', (tester) async {
      final backend = FakeBackend()
        ..tasks = [_working(), _waiting()]
        ..connections = [canvasConnection(on: true, needsLogin: true)];
      await openUnlockedApp(tester, backend);

      expect(find.text('Task needs you · $_waitingTitle'), findsOneWidget);
      expect(find.textContaining('Login needed'), findsNothing);

      await tester.tap(find.text('Task needs you · $_waitingTitle'));
      await settleRoute(tester);

      expect(find.text('Your Task'), findsOneWidget);
      expect(find.text('Which program should Buddy look at first?'), findsOneWidget);
    });

    testWidgets('shows a login Buddy is waiting for, and goes to that Connection', (tester) async {
      final backend = FakeBackend()
        ..tasks = [_working()]
        ..connections = [canvasConnection(on: true, needsLogin: true)];
      await openUnlockedApp(tester, backend);

      expect(find.text('Login needed · Canvas'), findsOneWidget);
      expect(find.textContaining('Task under way'), findsNothing);

      await tester.tap(find.text('Login needed · Canvas'));
      await tester.pumpAndSettle();

      expect(find.text('Canvas'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Log in to Canvas'), findsOneWidget);
    });

    testWidgets('with several logins waiting, goes to the list of Connections', (tester) async {
      final backend = FakeBackend()
        ..connections = [
          canvasConnection(on: true, needsLogin: true),
          canvasConnection(id: 'tuportal', name: 'TUportal', on: true, needsLogin: true),
        ];
      await openUnlockedApp(tester, backend);

      await tester.tap(find.text('Logins needed · 2 Connections'));
      await tester.pumpAndSettle();

      expect(find.text('Connections'), findsOneWidget);
      expect(find.text('TUportal'), findsOneWidget);
    });

    testWidgets('shows a Task under way, and opens it', (tester) async {
      await openUnlockedApp(tester, FakeBackend()..tasks = [_working()]);

      await tester.tap(find.text('Task under way · $_workingTitle'));
      await settleRoute(tester);

      expect(find.text('Your Task'), findsOneWidget);
      expect(find.text('Buddy is working on this.'), findsOneWidget);
    });

    testWidgets('goes once the Task has finished', (tester) async {
      final backend = FakeBackend()..tasks = [_working()];
      await openUnlockedApp(tester, backend);
      expect(find.text('Task under way · $_workingTitle'), findsOneWidget);

      backend.taskChanged(_done());
      await settleApp(tester);

      expect(find.textContaining('Task under way'), findsNothing);
    });

    testWidgets('a screen reader hears what it says and what tapping it does', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend()..tasks = [_waiting()]);

      final pill = find.bySemanticsLabel('A Task needs you: $_waitingTitle');
      expect(tester.getSemantics(pill), isSemantics(isButton: true, hasTapAction: true));
      expect(tester.getSemantics(pill).hintOverrides?.onTapHint, 'see what it needs');
      handle.dispose();
    });

    testWidgets('meets the tap target and label guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend()..connections = [canvasConnection(on: true, needsLogin: true)]);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      handle.dispose();
    });
  });

  group('the menu', () {
    testWidgets('opens a sheet with the ways around the app', (tester) async {
      _useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend());

      await _openMenu(tester);

      expect(find.text('Menu'), findsOneWidget);
      for (final way in ['Guidebook', 'Activity', 'Connections', 'Profile', 'Need help right now?']) {
        expect(find.text(way), findsOneWidget, reason: way);
      }
    });

    testWidgets('each way opens its own screen, with the menu closed behind it', (tester) async {
      _useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend());
      const screens = {
        'Guidebook': 'What Buddy has found for you, each with the page it came from.',
        'Activity': 'Nothing yet. What Buddy reads and does for you will show up here.',
        'Connections': 'What Buddy can read for you. Each one stays off until you give its Read Permission.',
        'Profile': 'What Buddy knows about you',
        'Need help right now?': 'Help is here, right now',
      };

      for (final MapEntry(key: way, value: shows) in screens.entries) {
        await _openMenu(tester);
        await tester.tap(find.text(way));
        await tester.pumpAndSettle();

        expect(find.text(shows), findsOneWidget, reason: way);
        expect(find.text('Menu'), findsNothing, reason: way);

        await tester.tap(find.text('Back'));
        await tester.pumpAndSettle();
      }
    });

    testWidgets('says how the Connections stand, in the words the You tab uses', (tester) async {
      _useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend()..connections = [canvasConnection(on: true, needsLogin: true)]);

      await _openMenu(tester);

      expect(find.text('Canvas needs login'), findsOneWidget);
    });

    testWidgets('is simply there, without rising, for a Student who has asked for less movement', (tester) async {
      _useOrdinaryPhone(tester);
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await openUnlockedApp(tester, FakeBackend());

      await tester.tap(find.byTooltip('Menu'));
      await tester.pump();
      await tester.pump();

      expect(find.text('Need help right now?').hitTestable(), findsOneWidget);
    });

    testWidgets('closes with its button', (tester) async {
      _useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend());
      await _openMenu(tester);

      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();

      expect(find.text('Menu'), findsNothing);
      expect(find.text('Your Temple guide'), findsOneWidget);
    });

    testWidgets('meets the tap target, label and contrast guidelines', (tester) async {
      _useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend());
      await _openMenu(tester);

      expect(tester.getSemantics(find.text('Menu')).flagsCollection.isHeader, isTrue);
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('fits at twice the text size on a small phone, and every way can be reached', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 568)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await openUnlockedApp(tester, FakeBackend());
      await _openMenu(tester);

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('Need help right now?'), 200, scrollable: find.byType(Scrollable).last);
      await tester.pump();
      expect(find.text('Need help right now?').hitTestable(), findsOneWidget);
    });
  });
}
