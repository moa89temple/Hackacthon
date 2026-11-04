import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/widgets/buddy_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

final at = DateTime(2026, 11, 2, 9);

ActivityEntry read() => ActivityEntry(
      title: 'Buddy read Google Calendar',
      detail: 'You tapped Read now.',
      at: at,
    );

const longReply =
    "You're free Tuesday from 2 to 4, going by your calendar. Want me to find tutoring then? It's free, and the Writing Center takes walk-ins too, though I can't confirm when it's open.";

ActivityEntry reply({
  String text = longReply,
  List<String> tools = const ['Looked at what Buddy has from your Google Calendar.'],
  List<DecisionSource> sources = const [DecisionSource(title: 'Writing Center', url: 'https://www.temple.edu/writing')],
  List<DecisionFact> facts = const [
    DecisionFact(text: 'Is a junior.', from: 'From your chat'),
    DecisionFact(text: 'Shift at CVS', detail: 'Tuesday, 2:00 PM–5:00 PM', from: 'From Google Calendar'),
  ],
}) =>
    ActivityEntry(
      title: 'Buddy replied',
      at: at,
      decision: ReplyDecision(reply: text, tools: tools, sources: sources, facts: facts),
    );

Future<void> openActivity(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend);
  await tester.tap(find.descendant(of: find.byType(BuddyNavBar), matching: find.text('You')));
  await settleApp(tester);
  // The You tab builds only what's near the screen, so on a small phone the row isn't there yet.
  await tester.dragUntilVisible(find.text('Activity'), find.byType(ListView).last, const Offset(0, -200));
  await tester.pump();
  await tester.tap(find.text('Activity'));
  await tester.pumpAndSettle();
}

Future<void> openDecision(WidgetTester tester) async {
  await tester.tap(find.text('How Buddy decided').first);
  await tester.pumpAndSettle();
}

void useSmallPhoneWithLargeText(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(320, 568)
    ..devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = 2;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

void main() {
  group('the Activity list', () {
    testWidgets('shows what Buddy read, why, and when', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [read()]);

      expect(find.text('Buddy read Google Calendar'), findsOneWidget);
      expect(find.text('You tapped Read now.'), findsOneWidget);
      // The day is over its group of entries, with only the time on the entry itself.
      expect(find.text('MONDAY, NOVEMBER 2, 2026'), findsOneWidget);
      expect(find.text('9:00 AM'), findsOneWidget);
    });

    testWidgets('shows an entry it has no special handling for, as later tickets will add', (tester) async {
      await openActivity(
        tester,
        FakeBackend()..activity = [ActivityEntry(title: 'Buddy made a Draft', at: at)],
      );

      expect(find.text('Buddy made a Draft'), findsOneWidget);
      expect(find.text('How Buddy decided'), findsNothing);
    });

    testWidgets('keeps the order the backend gave', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [ActivityEntry(title: 'Newer', at: at), read()]);

      expect(
        tester.getTopLeft(find.text('Newer')).dy,
        lessThan(tester.getTopLeft(find.text('Buddy read Google Calendar')).dy),
      );
    });

    testWidgets('offers how Buddy decided on a reply, and not on a read', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [reply(), read()]);

      expect(find.text('How Buddy decided'), findsOneWidget);
    });

    testWidgets('says so when nothing has happened yet', (tester) async {
      await openActivity(tester, FakeBackend());

      expect(find.textContaining('Nothing yet'), findsOneWidget);
      expect(find.byType(ChoiceChip), findsNothing);
    });

    testWidgets('offers a retry when it cannot be loaded', (tester) async {
      final backend = FakeBackend()..activityError = const BackendException('offline');
      await openActivity(tester, backend);

      expect(find.textContaining("couldn't load your Activity"), findsOneWidget);

      backend
        ..activityError = null
        ..activity = [read()];
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Buddy read Google Calendar'), findsOneWidget);
    });

    testWidgets('picks up what happened since, each time it opens', (tester) async {
      final backend = FakeBackend();
      await openActivity(tester, backend);
      expect(find.textContaining('Nothing yet'), findsOneWidget);

      backend.activity = [read()];
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Activity'));
      await tester.pumpAndSettle();

      expect(find.text('Buddy read Google Calendar'), findsOneWidget);
    });

    testWidgets('has no way to edit or remove an entry', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [reply(), read()]);

      for (final word in ['Edit', 'Delete', 'Remove']) {
        expect(find.textContaining(word), findsNothing);
      }
      expect(find.byType(Dismissible), findsNothing);
    });
  });

  group('how Buddy decided', () {
    testWidgets('shows the reply, the tools, the Sources and the Profile facts', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [reply()]);
      await openDecision(tester);

      expect(find.text(longReply), findsOneWidget);
      expect(find.text('What Buddy did, and the tools it used'), findsOneWidget);
      expect(find.text("Looked at what Buddy has from your Google Calendar."), findsOneWidget);
      expect(find.text('Sources Buddy looked at'), findsOneWidget);
      expect(find.text('Writing Center'), findsOneWidget);
      expect(find.text('https://www.temple.edu/writing'), findsOneWidget);
      expect(find.text('Profile facts Buddy had'), findsOneWidget);
      expect(find.text('Is a junior.'), findsOneWidget);
      expect(find.text('From your chat'), findsOneWidget);
      expect(find.text('Shift at CVS'), findsOneWidget);
      expect(find.text('Tuesday, 2:00 PM–5:00 PM'), findsOneWidget);
    });

    testWidgets('is honest that Buddy may not have used every fact', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [reply()]);
      await openDecision(tester);

      expect(find.textContaining('may not have used every one'), findsOneWidget);
    });

    testWidgets('says Buddy also had the conversation, because a reply can use what it saw earlier', (tester) async {
      await openActivity(
        tester,
        FakeBackend()..activity = [reply(tools: const [], sources: const [], facts: const [])],
      );
      await openDecision(tester);

      expect(find.textContaining('your conversation so far'), findsOneWidget);
    });

    testWidgets('says so when a reply used none of them', (tester) async {
      await openActivity(
        tester,
        FakeBackend()..activity = [reply(tools: const [], sources: const [], facts: const [])],
      );
      await openDecision(tester);

      expect(find.text('No tools for this reply.'), findsOneWidget);
      expect(find.text('No Sources for this reply.'), findsOneWidget);
      expect(find.text("Buddy wasn't given any Profile facts for this reply."), findsOneWidget);
    });

    testWidgets('has no way to edit or remove anything', (tester) async {
      await openActivity(tester, FakeBackend()..activity = [reply()]);
      await openDecision(tester);

      for (final word in ['Edit', 'Delete', 'Remove']) {
        expect(find.textContaining(word), findsNothing);
      }
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears each entry as one item', (tester) async {
      final handle = tester.ensureSemantics();
      await openActivity(tester, FakeBackend()..activity = [read()]);

      expect(
        find.bySemanticsLabel(
          'Buddy read Google Calendar\nYou tapped Read now.\nMonday, November 2, 2026 at 9:00 AM',
        ),
        findsOneWidget,
      );
      // The day over the group is in capitals on the screen, which a screen reader shouldn't be spelling out.
      expect(find.bySemanticsLabel('Monday, November 2, 2026'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears the whole reply in the list, though it is cut short on screen', (tester) async {
      final handle = tester.ensureSemantics();
      await openActivity(tester, FakeBackend()..activity = [reply()]);

      expect(find.bySemanticsLabel(RegExp(RegExp.escape(longReply))), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears which reply each button is for', (tester) async {
      final handle = tester.ensureSemantics();
      await openActivity(tester, FakeBackend()..activity = [reply(text: 'Short reply.')]);

      expect(find.bySemanticsLabel('How Buddy decided: Short reply.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a long reply does not make a long button label', (tester) async {
      final handle = tester.ensureSemantics();
      await openActivity(tester, FakeBackend()..activity = [reply()]);

      expect(find.bySemanticsLabel("How Buddy decided: You're free Tuesday from 2 to 4, going…"), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader can jump between the headings', (tester) async {
      final handle = tester.ensureSemantics();
      await openActivity(tester, FakeBackend()..activity = [reply()]);
      await openDecision(tester);

      for (final heading in ['What Buddy did, and the tools it used', 'Sources Buddy looked at', 'Profile facts Buddy had']) {
        expect(tester.getSemantics(find.text(heading)).flagsCollection.isHeader, isTrue, reason: heading);
      }
      handle.dispose();
    });

    testWidgets('a screen reader hears each fact as one item, with where it came from', (tester) async {
      final handle = tester.ensureSemantics();
      await openActivity(tester, FakeBackend()..activity = [reply()]);
      await openDecision(tester);

      expect(find.bySemanticsLabel('Shift at CVS\nTuesday, 2:00 PM–5:00 PM\nFrom Google Calendar'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a screen reader hears when the list could not load', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..activityError = const BackendException('offline');
      await openActivity(tester, backend);

      final problem = find.textContaining("couldn't load your Activity");
      expect(tester.getSemantics(problem).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('both screens fit at twice the text size on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openActivity(tester, FakeBackend()..activity = [reply(), read()]);
      expect(tester.takeException(), isNull, reason: 'overflow on the list');
      // The title and the choices of what to show come first, so with text this large the entries start further down.
      await tester.scrollUntilVisible(find.text('How Buddy decided'), 100);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow on the entries');
      expect(find.text('How Buddy decided').hitTestable(), findsOneWidget);

      await openDecision(tester);
      expect(tester.takeException(), isNull, reason: 'overflow on how Buddy decided');

      await tester.scrollUntilVisible(find.text('From Google Calendar'), 100, scrollable: find.byType(Scrollable).last);
      await tester.ensureVisible(find.text('From Google Calendar'));
      await tester.pumpAndSettle();
      expect(find.text('From Google Calendar').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'overflow further down');
    });
  });

  group('the real backend client', () {
    test('loads Activity with the device key, including how Buddy decided', () async {
      final backend = HttpBuddyBackend(
        Uri.parse('http://backend.test'),
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/activity');
          expect(request.headers['authorization'], 'Bearer the-key');
          return http.Response(
            jsonEncode({
              'entries': [
                {
                  'id': 2,
                  'kind': 'reply',
                  'title': 'Buddy replied',
                  'detail': null,
                  'at': '2026-11-02T14:00:00.000Z',
                  'decision': {
                    'reply': 'Hi there.',
                    'tools': ['Showed you the Crisis card.'],
                    'sources': [
                      {'title': 'Writing Center', 'url': 'https://www.temple.edu/writing'},
                    ],
                    'facts': [
                      {'text': 'Shift at CVS', 'detail': 'Tuesday', 'from': 'From Google Calendar'},
                      {'text': 'Is a junior.', 'from': 'From your chat'},
                    ],
                  },
                },
                {
                  'id': 1,
                  'kind': 'something_from_a_later_version',
                  'title': 'Buddy read Google Calendar',
                  'detail': 'You tapped Read now.',
                  'at': '2026-11-02T13:00:00.000Z',
                  'decision': null,
                },
              ],
            }),
            200,
          );
        }),
      );

      final [newest, oldest] = await backend.loadActivity();

      expect(newest.title, 'Buddy replied');
      expect(newest.at, DateTime.utc(2026, 11, 2, 14));
      expect(newest.decision!.reply, 'Hi there.');
      expect(newest.decision!.tools, ['Showed you the Crisis card.']);
      expect(newest.decision!.sources.single.url, 'https://www.temple.edu/writing');
      expect(newest.decision!.facts.first.detail, 'Tuesday');
      expect(newest.decision!.facts.last.detail, isNull);
      expect(oldest.detail, 'You tapped Read now.');
      expect(oldest.decision, isNull);
    });

    test('tells the app when the key is refused', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        Uri.parse('http://backend.test'),
        deviceKey: 'old-key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('{}', 401)),
      );

      await expectLater(backend.loadActivity(), throwsA(isA<BackendException>()));

      expect(refused, isTrue);
    });
  });
}
