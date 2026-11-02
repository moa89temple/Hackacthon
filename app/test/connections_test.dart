import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const secretAddress = 'https://calendar.google.com/calendar/ical/me/private-abc/basic.ics';

Connection calendar({bool on = false, DateTime? lastReadAt, String? problem, String? warning}) => Connection(
      id: 'google-calendar',
      name: 'Google Calendar',
      on: on,
      lastReadAt: lastReadAt,
      lastReadProblem: problem,
      card: ReadPermissionCardContent(
        reads: const ['The name, time and place of each event on this one calendar.'],
        notes: const ['Buddy can\'t change anything on your calendar.'],
        warning: warning,
        address: const AddressRequest(
          label: 'Secret address in iCal format',
          steps: ['Open Google Calendar on a computer.', 'Copy the address.'],
        ),
      ),
    );

Future<void> openYouTab(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend);
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
  await settleApp(tester);
}

Future<void> openCard(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Connect'));
  await tester.pump();
  await tester.tap(find.text('Connect'));
  await tester.pumpAndSettle();
}

Finder get giveButton => find.widgetWithText(FilledButton, 'Give Read Permission');

Future<void> pasteAndGive(WidgetTester tester, String address) async {
  await tester.enterText(find.widgetWithText(TextField, 'Secret address in iCal format'), address);
  await tester.pump();
  await tester.ensureVisible(giveButton);
  await tester.pump();
  await tester.tap(giveButton);
  await tester.pumpAndSettle();
}

/// The size of an ordinary phone. The card is taller than the default test window.
void useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  group('the list of Connections', () {
    testWidgets('shows a Connection that is off, and offers to connect it', (tester) async {
      await openYouTab(tester, FakeBackend()..connections = [calendar()]);

      expect(find.text('Connections'), findsOneWidget);
      expect(find.text('Google Calendar'), findsOneWidget);
      expect(find.text('Off'), findsOneWidget);
      expect(find.text('Connect'), findsOneWidget);
      expect(find.text('Read now'), findsNothing);
    });

    testWidgets('shows a Connection that is on, when it was last read, and offers read now', (tester) async {
      await openYouTab(
        tester,
        FakeBackend()..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7))],
      );

      expect(find.text('On. Last read Monday, November 2, 2026 at 7:00 AM.'), findsOneWidget);
      expect(find.text('Read now'), findsOneWidget);
      expect(find.text('Revoke'), findsOneWidget);
      expect(find.text('Connect'), findsNothing);
    });

    testWidgets('says so when it has never been read', (tester) async {
      await openYouTab(tester, FakeBackend()..connections = [calendar(on: true)]);

      expect(find.text("On. Buddy hasn't read it yet."), findsOneWidget);
    });

    testWidgets('shows what went wrong with the last read', (tester) async {
      await openYouTab(
        tester,
        FakeBackend()
          ..connections = [
            calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7), problem: "That address doesn't work any more."),
          ],
      );

      expect(find.text("That address doesn't work any more."), findsOneWidget);
    });

    testWidgets('offers a retry when it cannot be loaded', (tester) async {
      final backend = FakeBackend()..connectionsError = const BackendException('offline');
      await openYouTab(tester, backend);

      expect(find.textContaining('couldn\'t load your Connections'), findsOneWidget);

      backend
        ..connectionsError = null
        ..connections = [calendar()];
      await tester.ensureVisible(find.text('Try again').last);
      await tester.tap(find.text('Try again').last);
      await settleApp(tester);

      expect(find.text('Google Calendar'), findsOneWidget);
    });

    testWidgets('picks up the latest read when the Student comes back to the tab', (tester) async {
      final backend = FakeBackend()..connections = [calendar(on: true)];
      await openYouTab(tester, backend);

      backend.connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 13))];
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await settleApp(tester);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await settleApp(tester);

      expect(find.textContaining('at 1:00 PM'), findsOneWidget);
    });
  });

  group('read now', () {
    testWidgets('reads, then shows the new time and what the read saved', (tester) async {
      final backend = FakeBackend()..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7))];
      await openYouTab(tester, backend);

      backend
        ..connectionAfterRead = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9, 30))
        ..facts = [
          ProfileFact(
            id: 1,
            text: 'Shift at CVS',
            isFromConversation: false,
            savedAt: DateTime(2026, 11, 2, 9, 30),
            wasEdited: false,
          ),
        ];
      await tester.ensureVisible(find.text('Read now'));
      await tester.pump();
      await tester.tap(find.text('Read now'));
      await settleApp(tester);

      expect(backend.reads, ['google-calendar']);
      expect(find.textContaining('at 9:30 AM'), findsOneWidget);
      expect(find.text('Shift at CVS'), findsOneWidget);
    });

    testWidgets('can\'t be tapped twice while a read is under way', (tester) async {
      final backend = FakeBackend()
        ..connections = [calendar(on: true)]
        ..connectionAfterRead = calendar(on: true)
        ..holdRead = true;
      await openYouTab(tester, backend);

      await tester.ensureVisible(find.text('Read now'));
      await tester.pump();
      await tester.tap(find.text('Read now'));
      await tester.pump();

      expect(find.text('Reading…'), findsOneWidget);
      expect(tester.widget<OutlinedButton>(find.widgetWithText(OutlinedButton, 'Reading…')).onPressed, isNull);

      backend.releaseRead();
      await settleApp(tester);
      expect(backend.reads, hasLength(1));
      expect(find.text('Read now'), findsOneWidget);
    });

    testWidgets('says so when the backend cannot be reached', (tester) async {
      final backend = FakeBackend()
        ..connections = [calendar(on: true)]
        ..connectionChangeError = const BackendException('offline');
      await openYouTab(tester, backend);

      await tester.ensureVisible(find.text('Read now'));
      await tester.pump();
      await tester.tap(find.text('Read now'));
      await settleApp(tester);

      expect(find.textContaining("couldn't reach the backend"), findsOneWidget);
    });
  });

  group('the Read Permission card', () {
    testWidgets('says exactly what Buddy will read, and how to find the address', (tester) async {
      useOrdinaryPhone(tester);
      await openYouTab(tester, FakeBackend()..connections = [calendar()]);

      await openCard(tester);

      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
      expect(find.textContaining('The name, time and place of each event'), findsOneWidget);
      expect(find.textContaining("can't change anything"), findsOneWidget);
      expect(find.textContaining('Open Google Calendar on a computer.'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Secret address in iCal format'), findsOneWidget);
    });

    testWidgets('shows no warning when the service has no rule against automated tools', (tester) async {
      useOrdinaryPhone(tester);
      await openYouTab(tester, FakeBackend()..connections = [calendar()]);

      await openCard(tester);

      expect(find.textContaining('Warning:'), findsNothing);
    });

    testWidgets('shows the warning when a service\'s rules forbid automated tools', (tester) async {
      useOrdinaryPhone(tester);
      await openYouTab(
        tester,
        FakeBackend()..connections = [calendar(warning: "This service's own rules forbid automated tools.")],
      );

      await openCard(tester);

      expect(find.text("Warning: This service's own rules forbid automated tools."), findsOneWidget);
    });

    testWidgets('gives nothing until the Student has pasted the address and tapped', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()..connections = [calendar()];
      await openYouTab(tester, backend);

      await openCard(tester);
      expect(tester.widget<FilledButton>(giveButton).onPressed, isNull);

      await tester.enterText(find.widgetWithText(TextField, 'Secret address in iCal format'), secretAddress);
      await tester.pump();
      expect(tester.widget<FilledButton>(giveButton).onPressed, isNotNull);
      expect(backend.gave, isEmpty);
    });

    testWidgets('a tap sends the address, turns the Connection on and goes back', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..connectionAfterGive = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openYouTab(tester, backend);

      await openCard(tester);
      await pasteAndGive(tester, '  $secretAddress  ');

      expect(backend.gave, [('google-calendar', secretAddress)]);
      expect(find.text('Let Buddy read Google Calendar?'), findsNothing);
      expect(find.textContaining('On. Last read'), findsOneWidget);
    });

    testWidgets('shows why an address was refused, and keeps the card open', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const ReadPermissionRefused("That isn't your calendar's secret iCal address.");
      await openYouTab(tester, backend);

      await openCard(tester);
      await pasteAndGive(tester, 'https://example.test');

      expect(find.text("That isn't your calendar's secret iCal address."), findsOneWidget);
      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
      expect(tester.widget<FilledButton>(giveButton).onPressed, isNotNull);
    });

    testWidgets('says so when the backend cannot be reached', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const BackendException('offline');
      await openYouTab(tester, backend);

      await openCard(tester);
      await pasteAndGive(tester, secretAddress);

      expect(find.textContaining("couldn't reach the backend"), findsOneWidget);
    });
  });

  group('revoking', () {
    Future<void> tapRevoke(WidgetTester tester) async {
      await tester.ensureVisible(find.text('Revoke'));
      await tester.pump();
      await tester.tap(find.text('Revoke'));
      await tester.pumpAndSettle();
    }

    testWidgets('asks first, says what will be deleted, then turns it off and refreshes the Profile', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7))]
        ..connectionAfterRevoke = calendar()
        ..facts = [
          ProfileFact(
            id: 1,
            text: 'Shift at CVS',
            connectionName: 'Google Calendar',
            isFromConversation: false,
            savedAt: DateTime(2026, 11, 2, 7),
            wasEdited: false,
          ),
        ];
      await openYouTab(tester, backend);
      expect(find.text('Shift at CVS'), findsOneWidget);

      await tapRevoke(tester);
      expect(find.textContaining('deletes the address and every fact from it'), findsOneWidget);
      expect(find.textContaining('already showed the AI stays'), findsOneWidget);
      expect(backend.revoked, isEmpty);

      backend.facts = [];
      await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Revoke')));
      await tester.pumpAndSettle();

      expect(backend.revoked, ['google-calendar']);
      expect(find.text('Off'), findsOneWidget);
      expect(find.text('Shift at CVS'), findsNothing);
    });

    testWidgets('does nothing on Cancel', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()..connections = [calendar(on: true)];
      await openYouTab(tester, backend);

      await tapRevoke(tester);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(backend.revoked, isEmpty);
      expect(find.text('Read now'), findsOneWidget);
    });

    testWidgets('stays on and says so when the backend cannot be reached', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar(on: true)]
        ..connectionChangeError = const BackendException('offline');
      await openYouTab(tester, backend);

      await tapRevoke(tester);
      await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Revoke')));
      await tester.pumpAndSettle();

      expect(find.text('Read now'), findsOneWidget);
      expect(find.textContaining("couldn't reach the backend"), findsOneWidget);
    });
  });

  group('facts from a Connection', () {
    ProfileFact shift() => ProfileFact(
          id: 1,
          text: 'Shift at CVS',
          detail: 'Tue, Nov 3, 2:00 PM–5:00 PM',
          connectionName: 'Google Calendar',
          isFromConversation: false,
          savedAt: DateTime(2026, 11, 2, 12),
          wasEdited: false,
        );

    testWidgets('show their times and where they came from', (tester) async {
      await openYouTab(tester, FakeBackend()..facts = [shift()]);

      expect(find.text('Tue, Nov 3, 2:00 PM–5:00 PM'), findsOneWidget);
      expect(find.text('From Google Calendar, read on Monday, November 2, 2026.'), findsOneWidget);
    });

    testWidgets('say that a deletion lasts, because Buddy reads the calendar again', (tester) async {
      await openYouTab(tester, FakeBackend()..facts = [shift()]);

      await tester.tap(find.bySemanticsLabel('Delete: Shift at CVS'));
      await tester.pumpAndSettle();

      expect(find.textContaining('stays deleted when Buddy reads Google Calendar again'), findsOneWidget);
    });
  });

  group('the card in the conversation', () {
    Future<void> openChatWithCard(WidgetTester tester, FakeBackend backend) async {
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'When should I go to tutoring?');
      backend.reply.add(const ReplyReadPermissionCard('google-calendar'));
      await settleApp(tester);
    }

    testWidgets('appears as soon as Buddy suggests the Connection', (tester) async {
      useOrdinaryPhone(tester);
      await openChatWithCard(tester, FakeBackend()..connections = [calendar()]);

      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
    });

    testWidgets('is back in its place when the conversation loads', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(
        tester,
        FakeBackend(history: [student('When?'), const ReadPermissionCardItem('google-calendar'), buddy('It would help.')])
          ..connections = [calendar()],
      );

      final card = tester.getTopLeft(find.text('Let Buddy read Google Calendar?'));
      expect(card.dy, greaterThan(tester.getTopLeft(find.text('When?')).dy));
      expect(card.dy, lessThan(tester.getTopLeft(find.text('It would help.')).dy));
    });

    testWidgets('gives the Read Permission with a tap, then shows that it is on', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..connectionAfterGive = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openChatWithCard(tester, backend);

      await pasteAndGive(tester, secretAddress);

      expect(backend.gave, [('google-calendar', secretAddress)]);
      expect(find.text('Google Calendar is connected. You can revoke this on the You tab.'), findsOneWidget);
      expect(find.text('Let Buddy read Google Calendar?'), findsNothing);
    });

    testWidgets('catches up if the Read Permission went through but the answer never arrived', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const BackendException('dropped');
      await openChatWithCard(tester, backend);

      backend.connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9))];
      await pasteAndGive(tester, secretAddress);
      await settleApp(tester);

      expect(find.textContaining('Google Calendar is connected.'), findsOneWidget);
    });

    testWidgets('sending the address as a message does not give anything', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()..connections = [calendar()];
      await openChatWithCard(tester, backend);
      backend.reply.add(ReplyDone(buddy('Connecting it would help.')));
      await backend.reply.close();
      await settleApp(tester);
      backend.nextReply();

      await tester.enterText(find.widgetWithText(TextField, 'Message Buddy'), 'yes, go ahead');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pump();

      expect(backend.gave, isEmpty);
    });

    testWidgets('still shows a connected card for one already on', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(
        tester,
        FakeBackend(history: [const ReadPermissionCardItem('google-calendar')])
          ..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9))],
      );

      expect(find.textContaining('Google Calendar is connected.'), findsOneWidget);
    });

    testWidgets('says so, and offers a retry, when the card cannot be loaded', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend(history: [const ReadPermissionCardItem('google-calendar')])
        ..connectionsError = const BackendException('offline');
      await openUnlockedApp(tester, backend);

      expect(find.textContaining("couldn't load the card"), findsOneWidget);

      backend
        ..connectionsError = null
        ..connections = [calendar()];
      await tester.tap(find.text('Try again'));
      await settleApp(tester);

      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
    });

    testWidgets('leaves nothing broken for a Connection this version does not know', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend(history: [const ReadPermissionCardItem('from-the-future')]));

      expect(tester.takeException(), isNull);
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears which Connection each button is for', (tester) async {
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..connections = [calendar(on: true)]);

      expect(find.bySemanticsLabel('Read Google Calendar now'), findsOneWidget);
      expect(find.bySemanticsLabel('Revoke the Read Permission for Google Calendar'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears which Connection Connect is for', (tester) async {
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..connections = [calendar()]);

      expect(find.bySemanticsLabel('Connect Google Calendar'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the result of a read is announced', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [calendar(on: true)]
        ..connectionAfterRead = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openYouTab(tester, backend);

      await tester.ensureVisible(find.text('Read now'));
      await tester.pump();
      await tester.tap(find.text('Read now'));
      await settleApp(tester);

      final note = find.bySemanticsLabel('Buddy read Google Calendar.');
      expect(tester.getSemantics(note).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('a refused address is announced', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const ReadPermissionRefused('That address is wrong.');
      await openYouTab(tester, backend);

      await openCard(tester);
      await pasteAndGive(tester, 'nope');

      expect(tester.getSemantics(find.bySemanticsLabel('That address is wrong.')).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('the card and the list mark their headings', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..connections = [calendar()]);
      // By its own label, so that a heading merged in with other text doesn't pass.
      expect(tester.getSemantics(find.bySemanticsLabel('Google Calendar')).flagsCollection.isHeader, isTrue);

      await openCard(tester);

      for (final heading in [
        'Let Buddy read Google Calendar?',
        'What Buddy will read',
        'Good to know',
        'How to find the address',
      ]) {
        expect(tester.getSemantics(find.bySemanticsLabel(heading)).flagsCollection.isHeader, isTrue, reason: heading);
      }
      handle.dispose();
    });

    testWidgets('the list, card and dialog meet the tap target, label and contrast guidelines', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [
          calendar(warning: "This service's own rules forbid automated tools."),
        ];
      await openYouTab(tester, backend);

      Future<void> expectGuidelines() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      await expectGuidelines();
      await openCard(tester);
      await expectGuidelines();
      handle.dispose();
    });

    testWidgets('the Connected row and revoke dialog meet the guidelines too', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openYouTab(tester, FakeBackend()..connections = [calendar(on: true, problem: 'It failed.')]);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));

      await tester.ensureVisible(find.text('Revoke'));
      await tester.pump();
      await tester.tap(find.text('Revoke'));
      await tester.pumpAndSettle();

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    void useSmallPhoneWithLargeText(WidgetTester tester) {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    }

    testWidgets('the list, card and dialog fit at twice the text size on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final backend = FakeBackend()
        ..connections = [calendar(warning: "This service's own rules forbid automated tools.")]
        ..connectionAfterGive = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openYouTab(tester, backend);
      expect(tester.takeException(), isNull, reason: 'overflow on the list');

      await openCard(tester);
      expect(tester.takeException(), isNull, reason: 'overflow on the card');
      await tester.enterText(find.widgetWithText(TextField, 'Secret address in iCal format'), secretAddress);
      await tester.pump();
      await tester.ensureVisible(giveButton);
      await tester.pumpAndSettle();
      expect(giveButton.hitTestable(), findsOneWidget);
      await tester.tap(giveButton);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow once connected');

      await tester.ensureVisible(find.text('Revoke'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Revoke'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow in the dialog');
      await tester.ensureVisible(find.descendant(of: find.byType(AlertDialog), matching: find.text('Revoke')));
      await tester.pumpAndSettle();
      expect(find.descendant(of: find.byType(AlertDialog), matching: find.text('Revoke')).hitTestable(), findsOneWidget);
    });

    testWidgets('the card fits in the conversation at twice the text size on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openUnlockedApp(
        tester,
        FakeBackend(history: [const ReadPermissionCardItem('google-calendar')])..connections = [calendar()],
      );

      expect(tester.takeException(), isNull);
    });
  });
}
