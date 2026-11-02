import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const calendarPage = 'https://registrar.temple.edu/academic-calendar/2026-2027-academic-calendar';
const calendarTitle = '2026-2027 Academic Calendar';

StandardMilestone withdrawal({
  int id = 7,
  String name = 'Last day to withdraw from a Full Term 16-week course',
  String? term = 'Fall 2026',
  String when = 'Monday, December 7, 2026',
  bool passed = false,
  List<GuidebookSource>? sources,
}) =>
    StandardMilestone(
      id: id,
      name: name,
      term: term,
      when: when,
      passed: passed,
      sources: sources ??
          [GuidebookSource(url: calendarPage, title: calendarTitle, lastSeenAt: DateTime.utc(2026, 11, 2, 14))],
    );

Future<void> openToday(WidgetTester tester, FakeBackend backend, {PhoneOpener openPhone = pretendToOpenPhone}) async {
  await openUnlockedApp(tester, backend, openPhone: openPhone);
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Today')));
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

Future<void> tapThrough(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

List<StandardMilestone> dates(int count) => [
      for (var number = 1; number <= count; number++) withdrawal(id: number, name: 'Date number $number'),
    ];

void main() {
  group('the Today tab', () {
    testWidgets('shows each upcoming Standard Milestone with its date, its term and its Source', (tester) async {
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()]);

      expect(find.text('Last day to withdraw from a Full Term 16-week course'), findsOneWidget);
      expect(find.text('Monday, December 7, 2026'), findsOneWidget);
      expect(find.text('Fall 2026'), findsOneWidget);
      expect(find.text('Source: $calendarTitle'), findsOneWidget);
      expect(find.textContaining('Last seen'), findsOneWidget);
    });

    testWidgets('keeps them in the order the backend gives, which is soonest first', (tester) async {
      await openToday(tester, FakeBackend()..upcoming = [withdrawal(name: 'Sooner'), withdrawal(id: 8, name: 'Later')]);

      expect(tester.getTopLeft(find.text('Sooner')).dy, lessThan(tester.getTopLeft(find.text('Later')).dy));
    });

    testWidgets('leaves out a term the page does not give', (tester) async {
      await openToday(tester, FakeBackend()..upcoming = [withdrawal(term: null)]);

      expect(find.text('Fall 2026'), findsNothing);
    });

    testWidgets('says so when there is nothing yet, and shows no made-up dates', (tester) async {
      await openToday(tester, FakeBackend());

      expect(find.textContaining("Buddy reads Temple's calendar"), findsOneWidget);
      expect(find.byType(Card), findsNothing);
    });

    testWidgets('shows the first ten, and more when asked', (tester) async {
      await openToday(tester, FakeBackend()..upcoming = dates(12));

      await tester.scrollUntilVisible(find.text('Date number 10'), 200);
      expect(find.text('Date number 11'), findsNothing);

      await tester.scrollUntilVisible(find.text('Show 2 more'), 200);
      await tapThrough(tester, find.text('Show 2 more'));

      await tester.scrollUntilVisible(find.text('Date number 12'), 200);
      expect(find.text('Date number 12'), findsOneWidget);
      expect(find.textContaining('more'), findsNothing);
    });

    testWidgets('says how many more it will show, at most ten at a time', (tester) async {
      await openToday(tester, FakeBackend()..upcoming = dates(35));

      await tester.scrollUntilVisible(find.text('Show 10 more'), 200);

      expect(find.text('Show 10 more'), findsOneWidget);
    });

    testWidgets('reads the dates again each time the Student comes back to it', (tester) async {
      final backend = FakeBackend()..upcoming = [withdrawal(name: 'Old date')];
      await openToday(tester, backend);
      expect(find.text('Old date'), findsOneWidget);

      backend.upcoming = [withdrawal(name: 'New date')];
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await tester.pumpAndSettle();
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Today')));
      await tester.pumpAndSettle();

      expect(find.text('New date'), findsOneWidget);
      expect(find.text('Old date'), findsNothing);
    });
  });

  group('when the backend cannot be reached', () {
    testWidgets('says so and can try again', (tester) async {
      final backend = FakeBackend()
        ..upcomingError = Exception('off')
        ..upcoming = [withdrawal()];
      await openToday(tester, backend);

      expect(find.textContaining("Buddy couldn't load"), findsOneWidget);

      backend.upcomingError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Monday, December 7, 2026'), findsOneWidget);
      expect(find.textContaining("Buddy couldn't load"), findsNothing);
    });

    testWidgets('keeps what it was showing if a later read fails', (tester) async {
      final backend = FakeBackend()..upcoming = [withdrawal()];
      await openToday(tester, backend);

      backend.upcomingError = Exception('off');
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await tester.pumpAndSettle();
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Today')));
      await tester.pumpAndSettle();

      expect(find.text('Monday, December 7, 2026'), findsOneWidget);
    });
  });

  group('tapping a Source', () {
    testWidgets('opens its page', (tester) async {
      final opened = <Uri>[];
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()], openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tapThrough(tester, find.text('Source: $calendarTitle'));

      expect(opened, [Uri.parse(calendarPage)]);
    });

    testWidgets('opens nothing for an address that is not https', (tester) async {
      final opened = <Uri>[];
      final odd = [GuidebookSource(url: 'javascript:alert(1)', title: 'Odd page', lastSeenAt: DateTime.utc(2026, 11, 2))];
      await openToday(tester, FakeBackend()..upcoming = [withdrawal(sources: odd)], openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tester.tap(find.text('Source: Odd page'));
      await tester.pump();

      expect(opened, isEmpty);
    });

    testWidgets('says so when the phone could not open it', (tester) async {
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()], openPhone: (address) async => false);

      await tapThrough(tester, find.text('Source: $calendarTitle'));

      expect(find.textContaining("couldn't open that"), findsOneWidget);
    });

    testWidgets('shows a few Sources and says how many more there are', (tester) async {
      final source = GuidebookSource(url: calendarPage, title: 'A page', lastSeenAt: DateTime.utc(2026, 11, 2));
      await openToday(tester, FakeBackend()..upcoming = [withdrawal(sources: List.filled(5, source))]);

      expect(find.text('Source: A page'), findsNWidgets(3));
      expect(find.text('Also on 2 more of its pages.'), findsOneWidget);
    });
  });

  group('with a screen reader', () {
    testWidgets('reads each Milestone as one item, with its date', (tester) async {
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()]);

      expect(
        find.bySemanticsLabel(
          'Standard Milestone: Last day to withdraw from a Full Term 16-week course. Monday, December 7, 2026. Fall 2026.',
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('says what tapping the Source does and when it was last seen', (tester) async {
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()]);

      final link = find.bySemanticsLabel(RegExp('^Open Source: $calendarTitle, last seen .*2026'));
      expect(link, findsOneWidget);
      expect(tester.getSemantics(link).flagsCollection.isButton, isTrue);
      handle.dispose();
    });

    testWidgets('marks the heading as a heading', (tester) async {
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()]);

      expect(tester.getSemantics(find.text('Coming up')).flagsCollection.isHeader, isTrue);
      handle.dispose();
    });

    testWidgets('says how many more the button will show, and of what', (tester) async {
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcoming = dates(11));

      await tester.scrollUntilVisible(find.text('Show 1 more'), 200);

      expect(find.bySemanticsLabel('Show 1 more date'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the list meets the tap target, label and contrast guidelines', (tester) async {
      tester.view
        ..physicalSize = const Size(412, 915)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcoming = dates(11));

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('reads out a problem as it appears', (tester) async {
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcomingError = Exception('off'));

      final problem = find.textContaining("Buddy couldn't load");
      expect(tester.getSemantics(problem).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('reads out a Source the phone could not open', (tester) async {
      final handle = tester.ensureSemantics();
      await openToday(tester, FakeBackend()..upcoming = [withdrawal()], openPhone: (address) async => false);

      await tapThrough(tester, find.text('Source: $calendarTitle'));

      expect(tester.getSemantics(find.textContaining("couldn't open that")).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });
  });

  group('with larger text on a small phone', () {
    testWidgets('nothing overflows, and every control can be reached', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openToday(tester, FakeBackend()..upcoming = dates(11));

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('Show 1 more'), 200);
      expect(tester.takeException(), isNull);
      await tapThrough(tester, find.text('Show 1 more'));
      expect(tester.takeException(), isNull);
    });

    testWidgets('a long name and a long range of dates fit', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openToday(
        tester,
        FakeBackend()
          ..upcoming = [
            withdrawal(
              name: 'Last day to add with instructor permission or drop a Full Term 16-week course',
              when: 'Wednesday, December 9, 2026 to Friday, December 11, 2026',
            ),
          ],
      );

      expect(tester.takeException(), isNull);
    });

    testWidgets('the empty message fits', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openToday(tester, FakeBackend());
      expect(tester.takeException(), isNull);
    });

    testWidgets('the problem message and its button fit', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openToday(tester, FakeBackend()..upcomingError = Exception('off'));
      expect(tester.takeException(), isNull);
      expect(find.text('Try again'), findsOneWidget);
    });
  });

  group('in the conversation', () {
    Future<void> showInChat(WidgetTester tester, List<ConversationItem> history, {PhoneOpener openPhone = pretendToOpenPhone}) async {
      tester.view
        ..physicalSize = const Size(412, 915)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await openUnlockedApp(tester, FakeBackend()..history = history, openPhone: openPhone);
    }

    testWidgets('shows the date and the Source with the reply', (tester) async {
      await showInChat(tester, [
        student("When's the last day to withdraw?"),
        MilestoneCardItem(withdrawal()),
        buddy('December 7 for a 16-week course.'),
      ]);

      expect(find.text('Monday, December 7, 2026'), findsOneWidget);
      expect(find.text('Source: $calendarTitle'), findsOneWidget);
    });

    testWidgets('the Source opens its page', (tester) async {
      final opened = <Uri>[];
      await showInChat(tester, [student('When?'), MilestoneCardItem(withdrawal()), buddy('December 7.')], openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tapThrough(tester, find.text('Source: $calendarTitle'));

      expect(opened, [Uri.parse(calendarPage)]);
    });

    testWidgets('says so once a date has passed', (tester) async {
      await showInChat(tester, [student('When?'), MilestoneCardItem(withdrawal(passed: true)), buddy('December 7.')]);

      expect(find.text('This date has passed.'), findsOneWidget);
    });

    testWidgets('becomes a short note once the date has gone from its Source', (tester) async {
      await showInChat(tester, [student('When?'), MilestoneCardItem(null), buddy('December 7.')]);

      expect(find.textContaining("it's gone from its Source"), findsOneWidget);
      expect(find.byType(Card), findsNothing);
    });

    testWidgets('a card that arrives in a reply appears and is read out, and one from history is not', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()
        ..history = [student('When?'), MilestoneCardItem(withdrawal(name: 'From before')), buddy('Then.')];
      await openUnlockedApp(tester, backend);

      final oldLabel = find.bySemanticsLabel(RegExp('^Standard Milestone: From before'));
      expect(tester.getSemantics(oldLabel).flagsCollection.isLiveRegion, isFalse);

      await sendMessage(tester, 'And the next one?');
      backend.reply.add(ReplyMilestoneCard(withdrawal(id: 8, name: 'Just arrived')));
      await tester.pump();

      final newLabel = find.bySemanticsLabel(RegExp('^Standard Milestone: Just arrived'));
      expect(tester.getSemantics(newLabel).flagsCollection.isLiveRegion, isTrue);

      backend.reply
        ..add(ReplyDone(buddy('Done.')))
        ..close();
      await tester.pumpAndSettle();
      handle.dispose();
    });

    testWidgets('fits with larger text on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openUnlockedApp(tester, FakeBackend()..history = [student('When?'), MilestoneCardItem(withdrawal()), buddy('December 7.')]);

      expect(tester.takeException(), isNull);
    });
  });

  group('the real backend client', () {
    final milestoneJson = {
      'id': 7,
      'name': 'Last day to withdraw from a Full Term 16-week course',
      'term': 'Fall 2026',
      'date': '2026-12-07',
      'endDate': null,
      'when': 'Monday, December 7, 2026',
      'passed': false,
      'sources': [
        {'url': calendarPage, 'title': calendarTitle, 'lastSeenAt': '2026-11-02T14:00:00.000Z'},
      ],
    };

    HttpBuddyBackend clientWith(http.Client client) =>
        HttpBuddyBackend(Uri.parse('http://backend.test'), deviceKey: 'the-key', onKeyRefused: () {}, client: client);

    test('loads the upcoming Milestones with the device key', () async {
      final seen = <http.Request>[];
      final backend = clientWith(
        MockClient((request) async {
          seen.add(request);
          return http.Response(jsonEncode({'milestones': [milestoneJson]}), 200);
        }),
      );

      final [milestone] = await backend.loadUpcomingMilestones();

      expect(seen.single.url.path, '/milestones/upcoming');
      expect(seen.single.headers['authorization'], 'Bearer the-key');
      expect(milestone.name, 'Last day to withdraw from a Full Term 16-week course');
      expect(milestone.term, 'Fall 2026');
      expect(milestone.when, 'Monday, December 7, 2026');
      expect(milestone.passed, isFalse);
      expect(milestone.sources.single.url, calendarPage);
      expect(milestone.sources.single.lastSeenAt, DateTime.utc(2026, 11, 2, 14));
    });

    test('throws when the Milestones cannot be loaded', () async {
      final backend = clientWith(MockClient((request) async => http.Response('', 500)));

      await expectLater(backend.loadUpcomingMilestones(), throwsA(isA<BackendException>()));
    });

    test('reads a card in history, and one whose date has gone', () async {
      final backend = clientWith(
        MockClient(
          (request) async => http.Response(
            jsonEncode({
              'opening': 'Hi',
              'messages': [
                {'type': 'milestone_card', 'milestone': milestoneJson, 'sentAt': '2026-11-02T14:00:00.000Z'},
                {'type': 'milestone_card', 'milestone': null, 'sentAt': '2026-11-02T14:00:00.000Z'},
              ],
            }),
            200,
          ),
        ),
      );

      final items = await backend.loadHistory();
      final cards = items.whereType<MilestoneCardItem>().toList();

      expect(cards[0].milestone!.when, 'Monday, December 7, 2026');
      expect(cards[1].milestone, isNull);
    });

    test('reads a card as it arrives in a reply', () async {
      final backend = clientWith(
        MockClient.streaming(
          (request, body) async => http.StreamedResponse(
            Stream.value(utf8.encode('data: ${jsonEncode({'type': 'milestone_card', 'milestone': milestoneJson})}\n\n')),
            200,
          ),
        ),
      );

      final [event] = await backend.send('When?').toList();

      expect((event as ReplyMilestoneCard).milestone.name, startsWith('Last day to withdraw'));
    });
  });
}
