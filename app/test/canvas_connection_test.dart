import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const warning = "Canvas's own rules forbid this.";

Finder inTabs(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

Future<void> openTab(WidgetTester tester, FakeBackend backend, String tab) async {
  await openUnlockedApp(tester, backend);
  await tester.tap(inTabs(tab));
  await settleApp(tester);
}

/// The size of an ordinary phone. The card is taller than the default test window.
void useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void useSmallPhoneWithLargeText(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(320, 640)
    ..devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = 2;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

Future<void> expectGuidelines(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
  await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  await expectLater(tester, meetsGuideline(textContrastGuideline));
}

void main() {
  group('what the backend sends', () {
    Map<String, dynamic> json() => {
          'id': 'canvas',
          'name': 'Canvas',
          'on': true,
          'lastReadAt': null,
          'lastReadProblem': null,
          'card': {'reads': <String>[], 'notes': <String>[], 'warning': null, 'address': null},
        };

    test('says whether it logs in, needs a login, or still holds one', () {
      final connection = Connection.fromJson({...json(), 'logsIn': true, 'needsLogin': true, 'loginNotDeletedYet': true});

      expect(connection.logsIn, isTrue);
      expect(connection.needsLogin, isTrue);
      expect(connection.loginNotDeletedYet, isTrue);
    });

    test('leaves them off for a Connection that says nothing about them', () {
      final connection = Connection.fromJson(json());

      expect(connection.logsIn, isFalse);
      expect(connection.needsLogin, isFalse);
      expect(connection.loginNotDeletedYet, isFalse);
    });
  });

  group('the Read Permission card', () {
    testWidgets('shows what Buddy will read and warns about Canvas\'s own rules', (tester) async {
      await openTab(tester, FakeBackend()..connections = [canvasConnection()], 'You');
      await tester.ensureVisible(find.text('Connect'));
      await tester.pump();
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();

      expect(find.text('Let Buddy read Canvas?'), findsOneWidget);
      expect(find.text('Your courses this term.'), findsOneWidget);
      expect(find.text('Warning: $warning'), findsOneWidget);
      expect(find.byType(TextField), findsNothing);
    });

    testWidgets('says to log in next when the first read found no login', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection()]
        ..connectionAfterGive = canvasConnection(on: true, needsLogin: true, problem: 'Buddy needs you to log in to Canvas.');
      await openTab(tester, backend, 'You');
      await tester.ensureVisible(find.text('Connect'));
      await tester.pump();
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('Give Read Permission'));
      await tester.pump();
      await tester.tap(find.text('Give Read Permission'));
      await tester.pumpAndSettle();

      expect(backend.gave, [('canvas', null)]);
      expect(find.text('Canvas is connected. Log in so that Buddy can read it.'), findsOneWidget);
      expect(find.text('Log in to Canvas'), findsOneWidget);
    });
  });

  group('logging in', () {
    testWidgets('is offered only once the Read Permission is given', (tester) async {
      await openTab(tester, FakeBackend()..connections = [canvasConnection()], 'You');

      expect(find.text('Log in to Canvas'), findsNothing);
      expect(find.text('Connect'), findsOneWidget);
    });

    testWidgets('is offered on a Connection that needs one, and not on one that has no login', (tester) async {
      await openTab(
        tester,
        FakeBackend()..connections = [canvasConnection(on: true), canvasConnection(id: 'other', name: 'Other', on: true, logsIn: false)],
        'You',
      );

      expect(find.text('Log in to Canvas'), findsOneWidget);
      expect(find.text('Log in to Other'), findsNothing);
    });

    testWidgets('reads right after a login that worked', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true, needsLogin: true)]
        ..connectionAfterRead = canvasConnection(on: true, lastReadAt: DateTime(2026, 11, 2, 7))
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: true, title: 'Dashboard');
      await openTab(tester, backend, 'You');

      await tester.ensureVisible(find.text('Log in to Canvas'));
      await tester.pump();
      await tester.tap(find.text('Log in to Canvas'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(backend.startedSites, ['canvas']);
      expect(backend.reads, ['canvas']);
      expect(find.text('You\'re logged in to Canvas. Buddy opened "Dashboard" to check.'), findsOneWidget);
      expect(find.text('On. Last read Monday, November 2, 2026 at 7:00 AM.'), findsOneWidget);
    });

    testWidgets('does not read when the login could not be confirmed', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true, needsLogin: true)]
        ..takeoverToStart = canvasTakeover
        ..finished = const FinishedTakeover(siteName: 'Canvas', signedIn: false);
      await openTab(tester, backend, 'You');

      await tester.ensureVisible(find.text('Log in to Canvas'));
      await tester.pump();
      await tester.tap(find.text('Log in to Canvas'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();

      expect(backend.reads, isEmpty);
      expect(find.textContaining("Buddy couldn't confirm you're logged in to Canvas"), findsOneWidget);
    });

    testWidgets('a Takeover under way can be finished even if the Read Permission has gone', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection()]
        ..takeoverUnderWay = canvasTakeover
        ..takeoverToStart = canvasTakeover;
      await openTab(tester, backend, 'You');

      expect(find.text('Continue logging in to Canvas'), findsOneWidget);
    });
  });

  group('when the login has expired', () {
    Connection expired() => canvasConnection(
          on: true,
          needsLogin: true,
          problem: 'Buddy needs you to log in to Canvas before it can read it.',
          lastReadAt: DateTime(2026, 11, 2, 7),
        );

    testWidgets('the You tab says so, with a button', (tester) async {
      await openTab(tester, FakeBackend()..connections = [expired()], 'You');

      expect(find.text('Buddy needs you to log in to Canvas before it can read it.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Log in to Canvas'), findsOneWidget);
    });

    testWidgets('the Today tab asks for a Takeover', (tester) async {
      final backend = FakeBackend()
        ..connections = [expired()]
        ..takeoverToStart = canvasTakeover;
      await openTab(tester, backend, 'Today');

      expect(find.text('Canvas needs you to log in'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Log in to Canvas'));
      await tester.pumpAndSettle();

      expect(find.text('live view of ${canvasTakeover.liveViewUrl}'), findsOneWidget);
    });

    testWidgets('the Today tab asks nothing when the login works', (tester) async {
      await openTab(tester, FakeBackend()..connections = [canvasConnection(on: true)], 'Today');

      expect(find.textContaining('needs you to log in'), findsNothing);
    });

    testWidgets('the card in the conversation asks for a Takeover', (tester) async {
      final backend = FakeBackend()
        ..connections = [expired()]
        ..takeoverToStart = canvasTakeover
        ..history = [const ReadPermissionCardItem('canvas')];
      await openUnlockedApp(tester, backend);
      await settleApp(tester);

      expect(find.text('Canvas needs you to log in'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Log in to Canvas'));
      await tester.pumpAndSettle();

      expect(find.text('live view of ${canvasTakeover.liveViewUrl}'), findsOneWidget);
    });

    testWidgets('the card in the conversation says it is connected once the login works', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true)]
        ..history = [const ReadPermissionCardItem('canvas')];
      await openUnlockedApp(tester, backend);
      await settleApp(tester);

      expect(find.text('Canvas is connected. You can revoke this on the You tab.'), findsOneWidget);
      expect(find.text('Log in to Canvas'), findsNothing);
    });
  });

  group('revoking', () {
    Future<void> revoke(WidgetTester tester) async {
      await tester.ensureVisible(find.text('Revoke'));
      await tester.pump();
      await tester.tap(find.text('Revoke'));
      await tester.pumpAndSettle();
    }

    testWidgets('says the login goes too, and that it did', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true)]
        ..connectionAfterRevoke = canvasConnection();
      await openTab(tester, backend, 'You');
      await revoke(tester);

      expect(find.textContaining('your login in Buddy\'s Browser'), findsOneWidget);

      await tester.tap(find.widgetWithText(TextButton, 'Revoke').last);
      await tester.pumpAndSettle();

      expect(backend.revoked, ['canvas']);
      expect(find.text("Buddy can't read Canvas any more, and deleted the facts it saved from it and your login."), findsOneWidget);
    });

    testWidgets('says plainly when the login could not be deleted yet', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true)]
        ..connectionAfterRevoke = canvasConnection(loginNotDeletedYet: true);
      await openTab(tester, backend, 'You');
      await revoke(tester);
      await tester.tap(find.widgetWithText(TextButton, 'Revoke').last);
      await tester.pumpAndSettle();

      expect(find.textContaining("couldn't delete your login yet"), findsWidgets);
    });

    testWidgets('a Connection with no login says nothing of one', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvasConnection(id: 'other', name: 'Other', on: true, logsIn: false)]
        ..connectionAfterRevoke = canvasConnection(id: 'other', name: 'Other', logsIn: false);
      await openTab(tester, backend, 'You');
      await revoke(tester);

      expect(find.textContaining('login'), findsNothing);
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears the warning, the login request and its button', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openTab(
        tester,
        FakeBackend()..connections = [canvasConnection(on: true, needsLogin: true, problem: 'Buddy needs you to log in to Canvas.')],
        'Today',
      );

      expect(find.bySemanticsLabel('Canvas needs you to log in'), findsOneWidget);
      expect(tester.getSemantics(find.bySemanticsLabel('Canvas needs you to log in')).flagsCollection.isHeader, isTrue);
      expect(find.bySemanticsLabel('Log in to Canvas'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the warning on the card is read out', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openTab(tester, FakeBackend()..connections = [canvasConnection()], 'You');
      await tester.ensureVisible(find.text('Connect'));
      await tester.pump();
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();

      expect(find.bySemanticsLabel('Warning: $warning'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the You tab, Today tab and card meet the tap target, label and contrast guidelines', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true, needsLogin: true, problem: 'Buddy needs you to log in to Canvas.')];
      await openTab(tester, backend, 'Today');
      await expectGuidelines(tester);

      await tester.tap(inTabs('You'));
      await settleApp(tester);
      await expectGuidelines(tester);
      handle.dispose();
    });

    testWidgets('the login request in the conversation meets the guidelines too', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true, needsLogin: true)]
        ..history = [const ReadPermissionCardItem('canvas')];
      await openUnlockedApp(tester, backend);
      await settleApp(tester);

      await expectGuidelines(tester);
      handle.dispose();
    });

    testWidgets('the You tab fits at twice the text size on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final backend = FakeBackend()
        ..connections = [canvasConnection(on: true, needsLogin: true, problem: 'Buddy needs you to log in to Canvas before it can read it.')];
      await openTab(tester, backend, 'You');

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Log in to Canvas'));
      await tester.pumpAndSettle();
      expect(find.text('Log in to Canvas').hitTestable(), findsOneWidget);
    });

    testWidgets('the Today tab fits at twice the text size on a small phone, and the button can be reached', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openTab(tester, FakeBackend()..connections = [canvasConnection(on: true, needsLogin: true)], 'Today');

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Log in to Canvas'));
      await tester.pumpAndSettle();
      expect(find.text('Log in to Canvas').hitTestable(), findsOneWidget);
    });

    testWidgets('the card fits at twice the text size on a small phone, with its warning', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openTab(tester, FakeBackend()..connections = [canvasConnection()], 'You');
      await tester.ensureVisible(find.text('Connect'));
      await tester.pump();
      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.text('Give Read Permission'));
      await tester.pump();
      expect(find.text('Give Read Permission'), findsOneWidget);
    });
  });
}
