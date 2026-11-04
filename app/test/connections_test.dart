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

/// Brings something further down a long screen into view. Until then it isn't there to be found.
Future<void> scrollTo(WidgetTester tester, Finder target) async {
  await tester.scrollUntilVisible(target, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

Future<void> tapThrough(WidgetTester tester, String words) async {
  await scrollTo(tester, find.text(words));
  await tester.tap(find.text(words));
  await tester.pumpAndSettle();
}

/// One of the You tab's rows, whichever tab the Student is on.
Future<void> goToYouRow(WidgetTester tester, String row) async {
  await goToTab(tester, 'You');
  await settleApp(tester);
  await tapThrough(tester, row);
}

/// The list of Connections, one row in from the You tab.
Future<void> openConnections(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend);
  await goToYouRow(tester, 'Connections');
}

/// A Connection's row opens its Read Permission card if it's off, and its own screen if it's on.
Future<void> openConnection(WidgetTester tester, FakeBackend backend, String name) async {
  await openConnections(tester, backend);
  await tapThrough(tester, name);
}

Future<void> openCalendar(WidgetTester tester, FakeBackend backend) => openConnection(tester, backend, 'Google Calendar');

Future<void> goBack(WidgetTester tester) async {
  await tester.pageBack();
  await tester.pumpAndSettle();
}

/// Lets a screen arrive or leave over the conversation, where the dots never stop while a reply is due, so nothing
/// can wait for everything to settle.
Future<void> letScreenChange(WidgetTester tester) async {
  await settleApp(tester);
  await tester.pump(const Duration(seconds: 1));
  await tester.pump();
}

Finder get giveButton => find.widgetWithText(FilledButton, 'Give Read Permission');
Finder get addressField => find.widgetWithText(TextField, 'Secret address in iCal format');
Finder inDialog(String words) => find.descendant(of: find.byType(AlertDialog), matching: find.text(words));

Future<void> paste(WidgetTester tester, String address) async {
  await scrollTo(tester, addressField);
  await tester.enterText(addressField, address);
  await tester.pump();
}

Future<void> pasteAndGive(WidgetTester tester, String address) async {
  await paste(tester, address);
  await scrollTo(tester, giveButton);
  await tester.tap(giveButton);
  await tester.pumpAndSettle();
}

/// Everything on the longest screen fits at once, so a test can look at all of it, and only what's on the screen can be found.
void useTallPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 2000)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

/// The size of an ordinary phone.
void useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  group('the list of Connections', () {
    testWidgets('shows a Connection that is off, and offers to connect it', (tester) async {
      useTallPhone(tester);
      await openConnections(tester, FakeBackend()..connections = [calendar()]);

      expect(find.text('Connections'), findsOneWidget);
      expect(find.text('Google Calendar'), findsOneWidget);
      expect(find.text('Off'), findsOneWidget);
      expect(find.text('Read now'), findsNothing);

      await tapThrough(tester, 'Google Calendar');

      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
      expect(giveButton, findsOneWidget);
      expect(find.text('Read now'), findsNothing);
    });

    testWidgets('shows a Connection that is on, when it was last read, and offers read now', (tester) async {
      useTallPhone(tester);
      await openConnections(
        tester,
        FakeBackend()..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7))],
      );

      expect(find.text('On. Last read Monday, November 2, 2026 at 7:00 AM.'), findsOneWidget);

      await tapThrough(tester, 'Google Calendar');

      expect(find.text('On. Last read Monday, November 2, 2026 at 7:00 AM.'), findsOneWidget);
      expect(find.text('Read now'), findsOneWidget);
      expect(find.text('Revoke'), findsOneWidget);
      expect(giveButton, findsNothing);
    });

    testWidgets('says so when it has never been read', (tester) async {
      await openConnections(tester, FakeBackend()..connections = [calendar(on: true)]);

      expect(find.text("On. Buddy hasn't read it yet."), findsOneWidget);
    });

    group('that Buddy can\'t read yet', () {
      const why = "Buddy can't read Handshake yet.";

      Connection parked({required bool on}) => Connection(
            id: 'handshake',
            name: 'Handshake',
            on: on,
            logsIn: true,
            notReadableYet: why,
            card: ReadPermissionCardContent(reads: const ['Jobs.'], notes: const [], warning: null, address: null),
          );

      testWidgets('says so, and offers nothing to connect', (tester) async {
        useTallPhone(tester);
        await openConnections(tester, FakeBackend()..connections = [parked(on: false)]);

        expect(find.text(why), findsOneWidget);
        expect(find.text('Off'), findsNothing);

        await tapThrough(tester, 'Handshake');

        expect(find.text(why), findsOneWidget);
        expect(giveButton, findsNothing);
        expect(find.text('Revoke'), findsNothing);
      });

      testWidgets('offers only Revoke if it was connected, which is how the login gets deleted', (tester) async {
        useTallPhone(tester);
        await openConnection(tester, FakeBackend()..connections = [parked(on: true)], 'Handshake');

        expect(find.text(why), findsOneWidget);
        expect(find.text('Revoke'), findsOneWidget);
        expect(find.text('Read now'), findsNothing);
        expect(find.textContaining('Log in'), findsNothing);
      });
    });

    testWidgets('shows what went wrong with the last read', (tester) async {
      await openConnections(
        tester,
        FakeBackend()
          ..connections = [
            calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7), problem: "That address doesn't work any more."),
          ],
      );

      expect(find.text("That address doesn't work any more."), findsOneWidget);

      await tapThrough(tester, 'Google Calendar');

      expect(find.text("That address doesn't work any more."), findsOneWidget);
    });

    testWidgets('offers a retry when it cannot be loaded', (tester) async {
      final backend = FakeBackend()..connectionsError = const BackendException('offline');
      await openConnections(tester, backend);

      expect(find.textContaining('couldn\'t load your Connections'), findsOneWidget);

      backend
        ..connectionsError = null
        ..connections = [calendar()];
      await tester.tap(find.text('Try again'));
      await settleApp(tester);

      expect(find.text('Google Calendar'), findsOneWidget);
    });

    testWidgets('picks up the latest read when the Student comes back to the tab', (tester) async {
      final backend = FakeBackend()..connections = [calendar(on: true)];
      await openConnections(tester, backend);

      backend.connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 13))];
      await goBack(tester);
      await goToTab(tester, 'Buddy');
      await settleApp(tester);
      await goToYouRow(tester, 'Connections');

      expect(find.textContaining('at 1:00 PM'), findsOneWidget);
    });

    testWidgets('the row on the You tab says how they stand', (tester) async {
      Connection other({required bool needsLogin}) => canvasConnection(id: 'other', name: 'Other', on: true, needsLogin: needsLogin);
      final backend = FakeBackend()..connections = [calendar(), canvasConnection()];
      await openUnlockedApp(tester, backend);

      Future<void> expectRowToSay(List<Connection> connections, String words) async {
        backend.connections = connections;
        await goToTab(tester, 'You');
        await settleApp(tester);
        expect(find.text(words), findsOneWidget);
      }

      await expectRowToSay([calendar(), canvasConnection()], 'None on yet');
      await expectRowToSay([calendar(on: true), canvasConnection()], '1 of 2 on');
      await expectRowToSay([calendar(on: true), other(needsLogin: true)], 'Other needs login');
      await expectRowToSay([canvasConnection(on: true, needsLogin: true), other(needsLogin: true)], '2 need login');
    });
  });

  group('read now', () {
    testWidgets('reads, then shows the new time and what the read saved', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7))];
      await openCalendar(tester, backend);

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

      // Back without going through the tab bar, which would load the Profile by itself.
      await goBack(tester);
      await goBack(tester);
      await tapThrough(tester, 'Profile');

      expect(find.text('Shift at CVS'), findsOneWidget);
    });

    testWidgets('can\'t be tapped twice while a read is under way', (tester) async {
      final backend = FakeBackend()
        ..connections = [calendar(on: true)]
        ..connectionAfterRead = calendar(on: true)
        ..holdRead = true;
      await openCalendar(tester, backend);

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
      await openCalendar(tester, backend);

      await tester.ensureVisible(find.text('Read now'));
      await tester.pump();
      await tester.tap(find.text('Read now'));
      await settleApp(tester);

      expect(find.textContaining("couldn't reach the backend"), findsOneWidget);
    });
  });

  group('the Read Permission card', () {
    testWidgets('says exactly what Buddy will read, and how to find the address', (tester) async {
      useTallPhone(tester);
      await openCalendar(tester, FakeBackend()..connections = [calendar()]);

      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
      expect(find.textContaining('The name, time and place of each event'), findsOneWidget);
      expect(find.textContaining("can't change anything"), findsOneWidget);
      expect(addressField, findsOneWidget);
      // The steps are there for whoever wants them, and they aren't in the way of anyone else.
      expect(find.textContaining('Open Google Calendar on a computer.'), findsNothing);

      await tapThrough(tester, 'How to find this address');

      expect(find.textContaining('Open Google Calendar on a computer.'), findsOneWidget);
    });

    testWidgets('keeps the secret address hidden until the Student asks to see it', (tester) async {
      useTallPhone(tester);
      await openCalendar(tester, FakeBackend()..connections = [calendar()]);
      await paste(tester, secretAddress);

      TextField field() => tester.widget<TextField>(addressField);
      expect(field().obscureText, isTrue);

      await tapThrough(tester, 'Show');
      expect(field().obscureText, isFalse);

      await tapThrough(tester, 'Hide');
      expect(field().obscureText, isTrue);
    });

    testWidgets('shows no warning when the service has no rule against automated tools', (tester) async {
      useTallPhone(tester);
      await openCalendar(tester, FakeBackend()..connections = [calendar()]);

      expect(find.textContaining('Warning:'), findsNothing);
    });

    testWidgets('shows the warning when a service\'s rules forbid automated tools', (tester) async {
      useTallPhone(tester);
      await openCalendar(
        tester,
        FakeBackend()..connections = [calendar(warning: "This service's own rules forbid automated tools.")],
      );

      expect(find.text("Warning: This service's own rules forbid automated tools."), findsOneWidget);
    });

    testWidgets('gives nothing until the Student has pasted the address and tapped', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()..connections = [calendar()];
      await openCalendar(tester, backend);

      expect(tester.widget<FilledButton>(giveButton).onPressed, isNull);

      await paste(tester, secretAddress);
      expect(tester.widget<FilledButton>(giveButton).onPressed, isNotNull);
      expect(backend.gave, isEmpty);
    });

    testWidgets('a tap sends the address, turns the Connection on and goes back', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..connectionAfterGive = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openCalendar(tester, backend);

      await pasteAndGive(tester, '  $secretAddress  ');

      expect(backend.gave, [('google-calendar', secretAddress)]);
      expect(find.text('Let Buddy read Google Calendar?'), findsNothing);
      expect(find.textContaining('On. Last read'), findsOneWidget);
    });

    testWidgets('shows why an address was refused, and keeps the card open', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const ReadPermissionRefused("That isn't your calendar's secret iCal address.");
      await openCalendar(tester, backend);

      await pasteAndGive(tester, 'https://example.test');

      expect(find.text("That isn't your calendar's secret iCal address."), findsOneWidget);
      expect(find.text('Let Buddy read Google Calendar?'), findsOneWidget);
      expect(tester.widget<FilledButton>(giveButton).onPressed, isNotNull);
    });

    testWidgets('says so when the backend cannot be reached', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const BackendException('offline');
      await openCalendar(tester, backend);

      await pasteAndGive(tester, secretAddress);

      expect(find.textContaining("couldn't reach the backend"), findsOneWidget);
    });
  });

  group('revoking', () {
    Future<void> tapRevoke(WidgetTester tester) => tapThrough(tester, 'Revoke');

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
      await openUnlockedApp(tester, backend);
      await goToYouRow(tester, 'Profile');
      expect(find.text('Shift at CVS'), findsOneWidget);

      await goBack(tester);
      await tapThrough(tester, 'Connections');
      await tapThrough(tester, 'Google Calendar');
      await tapRevoke(tester);
      expect(find.textContaining('deletes the address and every fact from it'), findsOneWidget);
      expect(find.textContaining('already showed the AI stays'), findsOneWidget);
      expect(backend.revoked, isEmpty);

      backend.facts = [];
      await tester.tap(inDialog('Revoke'));
      await tester.pumpAndSettle();

      expect(backend.revoked, ['google-calendar']);
      expect(find.text('Off'), findsOneWidget);

      await goBack(tester);
      await tapThrough(tester, 'Profile');
      expect(find.text('Shift at CVS'), findsNothing);
    });

    testWidgets('does nothing on Cancel', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()..connections = [calendar(on: true)];
      await openCalendar(tester, backend);

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
      await openCalendar(tester, backend);

      await tapRevoke(tester);
      await tester.tap(inDialog('Revoke'));
      await tester.pumpAndSettle();

      expect(find.text('Read now'), findsOneWidget);
      expect(find.text("On. Buddy hasn't read it yet."), findsOneWidget);
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

    Future<void> openProfile(WidgetTester tester, FakeBackend backend) async {
      await openUnlockedApp(tester, backend);
      await goToYouRow(tester, 'Profile');
    }

    testWidgets('show their times and where they came from', (tester) async {
      await openProfile(tester, FakeBackend()..facts = [shift()]);

      expect(find.text('Tue, Nov 3, 2:00 PM–5:00 PM'), findsOneWidget);
      expect(find.text('From Google Calendar, read on Monday, November 2, 2026.'), findsOneWidget);
    });

    testWidgets('say that a deletion lasts, because Buddy reads the calendar again', (tester) async {
      await openProfile(tester, FakeBackend()..facts = [shift()]);

      await tester.tap(find.byTooltip('Change or delete: Shift at CVS'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
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

    Future<void> reviewAndDecide(WidgetTester tester) async {
      await tester.tap(find.text('Review and decide'));
      await letScreenChange(tester);
    }

    Future<void> pasteAndGiveOverConversation(WidgetTester tester, String address) async {
      await paste(tester, address);
      await tester.tap(giveButton);
      await letScreenChange(tester);
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

      // Under the words that introduce it, in the turn it belongs to.
      final card = tester.getTopLeft(find.text('Let Buddy read Google Calendar?'));
      expect(card.dy, greaterThan(tester.getTopLeft(find.text('When?')).dy));
      expect(card.dy, greaterThan(tester.getTopLeft(find.text('It would help.')).dy));
    });

    testWidgets('decides nothing by itself, and opens the whole card to decide on', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()..connections = [calendar()];
      await openChatWithCard(tester, backend);

      expect(giveButton, findsNothing);
      expect(addressField, findsNothing);

      await reviewAndDecide(tester);

      expect(find.textContaining('The name, time and place of each event'), findsOneWidget);
      expect(giveButton, findsOneWidget);
      expect(backend.gave, isEmpty);
    });

    testWidgets('gives the Read Permission with a tap, then shows that it is on', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..connectionAfterGive = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openChatWithCard(tester, backend);

      await reviewAndDecide(tester);
      await pasteAndGiveOverConversation(tester, secretAddress);

      expect(backend.gave, [('google-calendar', secretAddress)]);
      expect(find.text('Google Calendar is connected. You can revoke this in You > Connections.'), findsOneWidget);
      expect(find.text('Let Buddy read Google Calendar?'), findsNothing);
    });

    testWidgets('catches up if the Read Permission went through but the answer never arrived', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()
        ..connections = [calendar()]
        ..giveError = const BackendException('dropped');
      await openChatWithCard(tester, backend);
      await reviewAndDecide(tester);

      backend.connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9))];
      await pasteAndGiveOverConversation(tester, secretAddress);
      await tester.pageBack();
      await letScreenChange(tester);

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

  group('a service the Student asked for', () {
    const details = ServiceDetails(domain: 'notion.com', routeInWords: 'Through the connector notion.com publishes itself, at mcp.notion.com');
    const words = ReadPermissionCardContent(
      reads: ['What the connector can look up about you, using only the tools notion.com marks as read-only.'],
      notes: ['Buddy switches on only the tools marked as read-only.'],
      warning: null,
      address: null,
    );

    Connection notion({bool on = false, bool needsLogin = false, bool loginNotDeletedYet = false, String name = 'Notion'}) => Connection(
          id: 'service-notion.com',
          name: name,
          on: on,
          logsIn: true,
          needsLogin: needsLogin,
          loginNotDeletedYet: loginNotDeletedYet,
          service: details,
          card: words,
        );

    testWidgets('shows on the list with its web address and how Buddy reads it', (tester) async {
      await openConnections(tester, FakeBackend()..connections = [notion()]);

      expect(find.text('Notion'), findsOneWidget);
      expect(find.text('notion.com. Through the connector notion.com publishes itself, at mcp.notion.com. Off'), findsOneWidget);
    });

    testWidgets('its card shows its name, its web address and the route before anything is given', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()..connections = [notion()];
      await openConnection(tester, backend, 'Notion');

      expect(find.text('Let Buddy read Notion?'), findsOneWidget);
      expect(find.text('Name: Notion'), findsOneWidget);
      expect(find.text('Web address: notion.com'), findsOneWidget);
      expect(find.text('How Buddy reads it: Through the connector notion.com publishes itself, at mcp.notion.com.'), findsOneWidget);
      expect(find.textContaining('Warning'), findsNothing);
      expect(find.byType(TextField), findsNothing);
      expect(backend.gave, isEmpty);
    });

    testWidgets('a tap on its card is what gives the Read Permission, and it then asks for a login', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..connections = [notion()]
        ..connectionAfterGive = notion(on: true, needsLogin: true);
      await openConnection(tester, backend, 'Notion');

      await scrollTo(tester, giveButton);
      await tester.tap(giveButton);
      await tester.pumpAndSettle();

      expect(backend.gave, [('service-notion.com', null)]);
      expect(find.text('Notion is connected'), findsOneWidget);
      expect(find.text('Log in to Notion'), findsOneWidget);
      expect(find.text('Not now'), findsOneWidget);
    });

    testWidgets('a name from the model is shown as plain words, whatever it looks like', (tester) async {
      useOrdinaryPhone(tester);
      const name = '**Tap** [here](https://evil.example)';
      await openConnection(tester, FakeBackend()..connections = [notion(name: name)], name);

      expect(find.text('Name: $name'), findsOneWidget);
    });

    testWidgets('its card in the conversation shows up even though it wasn\'t on the list when the app last looked', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Connect my Notion');

      backend.connections = [notion()];
      backend.reply.add(const ReplyReadPermissionCard('service-notion.com'));
      await settleApp(tester);

      expect(find.text('Let Buddy read Notion?'), findsOneWidget);

      await tester.tap(find.text('Review and decide'));
      await letScreenChange(tester);

      expect(find.text('Web address: notion.com'), findsOneWidget);
    });

    testWidgets('revoking warns what goes, then takes it off the list', (tester) async {
      final backend = FakeBackend()
        ..connections = [notion(on: true)]
        ..connectionAfterRevoke = notion()
        ..revokeRemovesIt = true;
      await openConnection(tester, backend, 'Notion');

      await tapThrough(tester, 'Revoke');
      expect(find.textContaining('anything it holds to log in'), findsOneWidget);
      await tester.tap(inDialog('Revoke'));
      await tester.pumpAndSettle();

      expect(backend.revoked, ['service-notion.com']);
      expect(find.text('Notion'), findsNothing);
      expect(find.textContaining('took it off your list'), findsOneWidget);
    });

    testWidgets('stays on the list saying so while its login can\'t be deleted yet', (tester) async {
      final backend = FakeBackend()
        ..connections = [notion(on: true)]
        ..connectionAfterRevoke = notion(loginNotDeletedYet: true);
      await openConnection(tester, backend, 'Notion');

      await tapThrough(tester, 'Revoke');
      await tester.tap(inDialog('Revoke'));
      await settleApp(tester);
      await tester.pumpAndSettle();

      expect(find.textContaining("couldn't delete your login yet"), findsWidgets);

      await goBack(tester);

      expect(find.text('Notion'), findsOneWidget);
      expect(find.textContaining("couldn't delete your login yet"), findsWidgets);

      // It's off, but there's still something to say about it, so its row leads to its own screen and not to the question.
      await tapThrough(tester, 'Notion');

      expect(find.textContaining("Buddy couldn't delete your login yet, because Buddy's Browser couldn't be reached."), findsOneWidget);
      expect(giveButton, findsNothing);
    });

    testWidgets('can be taken off the list without connecting it', (tester) async {
      final backend = FakeBackend()
        ..connections = [notion()]
        ..connectionAfterRevoke = notion()
        ..revokeRemovesIt = true;
      await openConnection(tester, backend, 'Notion');

      await tapThrough(tester, 'Remove');

      expect(backend.revoked, ['service-notion.com']);
      expect(find.text('Notion'), findsNothing);
      expect(find.text('Buddy took Notion off your list.'), findsOneWidget);
    });

    testWidgets('one of Buddy\'s own Connections has no Remove and no section about the service', (tester) async {
      useTallPhone(tester);
      await openCalendar(tester, FakeBackend()..connections = [calendar()]);

      expect(giveButton, findsOneWidget);
      expect(find.text('Remove'), findsNothing);
      expect(find.text('The service'), findsNothing);
    });

    testWidgets('says plainly that a login worked when Buddy has no page to name', (tester) async {
      final backend = FakeBackend()
        ..connections = [notion(on: true, needsLogin: true)]
        ..connectionAfterRead = notion(on: true);
      backend.takeoverToStart = Takeover(site: 'service-notion.com', siteName: 'Notion', liveViewUrl: canvasTakeover.liveViewUrl);
      backend.finished = const FinishedTakeover(siteName: 'Notion', signedIn: true);

      await openConnection(tester, backend, 'Notion');
      await tapThrough(tester, 'Log in to Notion');
      await tester.tap(find.text('Done'));
      await tester.pumpAndSettle();
      expect(find.text("You're logged in to Notion."), findsOneWidget);
      expect(find.textContaining('null'), findsNothing);
    });

    group('accessibility', () {
      testWidgets('a screen reader hears each part of its row, and which service each button is for', (tester) async {
        useTallPhone(tester);
        final handle = tester.ensureSemantics();
        await openConnections(tester, FakeBackend()..connections = [notion()]);

        expect(find.bySemanticsLabel('Notion. notion.com. Through the connector notion.com publishes itself, at mcp.notion.com. Off'), findsOneWidget);

        await tapThrough(tester, 'Notion');

        expect(find.bySemanticsLabel('Remove Notion from your list'), findsOneWidget);
        handle.dispose();
      });

      testWidgets('its card marks the new heading as one', (tester) async {
        useOrdinaryPhone(tester);
        final handle = tester.ensureSemantics();
        await openConnection(tester, FakeBackend()..connections = [notion()], 'Notion');

        expect(tester.getSemantics(find.bySemanticsLabel('The service')).flagsCollection.isHeader, isTrue);
        handle.dispose();
      });

      testWidgets('its row and its card fit with larger text', (tester) async {
        useOrdinaryPhone(tester);
        tester.platformDispatcher.textScaleFactorTestValue = 2;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await openConnections(tester, FakeBackend()..connections = [notion(name: 'A service with a rather long name')]);

        expect(tester.takeException(), isNull);
        await tapThrough(tester, 'A service with a rather long name');

        expect(tester.takeException(), isNull);
        await scrollTo(tester, find.text('Web address: notion.com'));
        expect(find.text('Web address: notion.com'), findsOneWidget);
      });
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears which Connection each button is for', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openCalendar(tester, FakeBackend()..connections = [calendar(on: true)]);

      expect(find.bySemanticsLabel('Read Google Calendar now'), findsOneWidget);
      expect(find.bySemanticsLabel('Revoke the Read Permission for Google Calendar'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears which Connection a row leads to', (tester) async {
      final handle = tester.ensureSemantics();
      await openConnections(tester, FakeBackend()..connections = [calendar()]);

      final row = find.bySemanticsLabel('Google Calendar. Off');
      expect(row, findsOneWidget);
      expect(tester.getSemantics(row).flagsCollection.isButton, isTrue);
      handle.dispose();
    });

    testWidgets('a screen reader hears which Connection the card in the conversation is about', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(
        tester,
        FakeBackend(history: [const ReadPermissionCardItem('google-calendar')])..connections = [calendar()],
      );

      expect(find.bySemanticsLabel('Review and decide: let Buddy read Google Calendar'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears each Connection with its own status and any problem', (tester) async {
      final handle = tester.ensureSemantics();
      await openConnections(
        tester,
        FakeBackend()..connections = [calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 7), problem: 'It failed.')],
      );

      expect(
        find.bySemanticsLabel(RegExp(r'^Google Calendar\W+On\. Last read Monday, November 2, 2026 at 7:00 AM\.\s+It failed\.$')),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('a screen reader hears each calendar fact as one item, with its times', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(
        tester,
        FakeBackend()
          ..facts = [
            ProfileFact(
              id: 1,
              text: 'Shift at CVS',
              detail: 'Tue, Nov 3, 2:00 PM–5:00 PM',
              connectionName: 'Google Calendar',
              isFromConversation: false,
              savedAt: DateTime(2026, 11, 2, 12),
              wasEdited: false,
            ),
          ],
      );
      await goToYouRow(tester, 'Profile');

      expect(
        find.bySemanticsLabel(
          'Shift at CVS\nTue, Nov 3, 2:00 PM–5:00 PM\nFrom Google Calendar, read on Monday, November 2, 2026.',
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('the result of a read is announced', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [calendar(on: true)]
        ..connectionAfterRead = calendar(on: true, lastReadAt: DateTime(2026, 11, 2, 9));
      await openCalendar(tester, backend);

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
      await openCalendar(tester, backend);

      await pasteAndGive(tester, 'nope');

      expect(tester.getSemantics(find.bySemanticsLabel('That address is wrong.')).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('the card and the list mark their headings', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openConnections(tester, FakeBackend()..connections = [calendar()]);
      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Connections'))).flagsCollection.isHeader, isTrue);

      await tapThrough(tester, 'Google Calendar');

      // A heading that starts a block is read out together with the block's first words, so it's found by how it starts.
      for (final heading in [
        'Let Buddy read Google Calendar?',
        'What Buddy will read',
        'Ongoing access',
        'Good to know',
        'Secret calendar address',
        'You stay in control',
      ]) {
        final node = find.bySemanticsLabel(RegExp('^${RegExp.escape(heading)}'));
        expect(tester.getSemantics(node).flagsCollection.isHeader, isTrue, reason: heading);
      }
      // How to find the address opens and closes now, so it's a button and not a heading.
      expect(tester.getSemantics(find.bySemanticsLabel('How to find this address')).flagsCollection.isButton, isTrue);
      handle.dispose();
    });

    testWidgets('the list, card and dialog meet the tap target, label and contrast guidelines', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..connections = [
          calendar(warning: "This service's own rules forbid automated tools."),
        ];
      await openConnections(tester, backend);

      Future<void> expectGuidelines() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      await expectGuidelines();
      await tapThrough(tester, 'Google Calendar');
      await expectGuidelines();
      handle.dispose();
    });

    testWidgets('the Connected row, its screen and the revoke dialog meet the guidelines too', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openConnections(tester, FakeBackend()..connections = [calendar(on: true, problem: 'It failed.')]);

      Future<void> expectGuidelines() async {
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      }

      await expectGuidelines();

      await tapThrough(tester, 'Google Calendar');
      await expectGuidelines();

      await tapThrough(tester, 'Revoke');
      await expectGuidelines();
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
      await openConnections(tester, backend);
      expect(tester.takeException(), isNull, reason: 'overflow on the list');

      await tapThrough(tester, 'Google Calendar');
      expect(tester.takeException(), isNull, reason: 'overflow on the card');
      await paste(tester, secretAddress);
      await scrollTo(tester, giveButton);
      expect(giveButton.hitTestable(), findsOneWidget);
      await tester.tap(giveButton);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow once connected');

      await tapThrough(tester, 'Google Calendar');
      expect(tester.takeException(), isNull, reason: "overflow on the Connection's own screen");

      await tapThrough(tester, 'Revoke');
      expect(tester.takeException(), isNull, reason: 'overflow in the dialog');
      await tester.ensureVisible(inDialog('Revoke'));
      await tester.pumpAndSettle();
      expect(inDialog('Revoke').hitTestable(), findsOneWidget);
    });

    testWidgets('the card fits in the conversation at twice the text size on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openUnlockedApp(
        tester,
        FakeBackend(history: [const ReadPermissionCardItem('google-calendar')])..connections = [calendar()],
      );

      expect(tester.takeException(), isNull);
      await scrollTo(tester, find.text('Review and decide'));
      expect(find.text('Review and decide').hitTestable(), findsOneWidget);
    });
  });
}
