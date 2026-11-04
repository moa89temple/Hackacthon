import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const writingPage = 'https://studentsuccess.temple.edu/programs/writing';

GuidebookItem writingCenter({
  int id = 7,
  String? cost = 'Free',
  String? phone,
  String? phoneToDial,
  String? email,
  String? place,
  String? hours,
  List<GuidebookSource>? sources,
}) =>
    GuidebookItem(
      id: id,
      name: 'Writing Center',
      summary: 'Student writers help student writers.',
      cost: cost,
      phone: phone,
      phoneToDial: phoneToDial,
      email: email,
      place: place,
      hours: hours,
      sources: sources ??
          [
            GuidebookSource(
              url: writingPage,
              title: 'Writing Center | Student Success Center',
              lastSeenAt: DateTime.utc(2026, 11, 2, 14),
            ),
          ],
    );

/// A small phone with text at twice the size, the hardest case for the card's layout.
void useSmallPhoneWithLargeText(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(320, 640)
    ..devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = 2;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

Future<void> showCard(
  WidgetTester tester,
  GuidebookItem item, {
  PhoneOpener openPhone = pretendToOpenPhone,
  FakeBackend? backend,
}) async {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await openUnlockedApp(
    tester,
    (backend ?? FakeBackend())..history = [student('Help?'), GuidebookCardItem(item), buddy('Try this.')],
    openPhone: openPhone,
  );
}

Future<void> tapThrough(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  group('what the card shows', () {
    testWidgets('its name, what it does, what it costs and its Source', (tester) async {
      await showCard(tester, writingCenter());

      expect(find.text('Writing Center'), findsOneWidget);
      expect(find.text('Student writers help student writers.'), findsOneWidget);
      expect(find.text('Free'), findsOneWidget);
      expect(find.text('Source: Writing Center'), findsOneWidget);
      expect(find.text('Last seen Nov 2'), findsOneWidget);
    });

    testWidgets('leaves out what the Guidebook does not have', (tester) async {
      await showCard(tester, writingCenter(cost: null));

      expect(find.textContaining('Free'), findsNothing);
      expect(find.textContaining('Call'), findsNothing);
      expect(find.textContaining('Email'), findsNothing);
    });

    testWidgets('where it is and when it is open', (tester) async {
      await showCard(tester, writingCenter(place: 'Charles Library 230', hours: 'Mon 8:30AM-8:30PM'));

      expect(find.text('Where: Charles Library 230'), findsOneWidget);
      expect(find.text('When: Mon 8:30AM-8:30PM'), findsOneWidget);
    });

    testWidgets('shows a few Sources and says how many more there are', (tester) async {
      final source = GuidebookSource(url: writingPage, title: 'A page', lastSeenAt: DateTime.utc(2026, 11, 2));
      await showCard(tester, writingCenter(sources: List.filled(5, source)));

      expect(find.text('Source: A page'), findsNWidgets(3));
      expect(find.text('Also on 2 more of its pages.'), findsOneWidget);
    });
  });

  group('tapping', () {
    testWidgets('the Source opens its page', (tester) async {
      final opened = <Uri>[];
      await showCard(tester, writingCenter(), openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tapThrough(tester, find.text('Source: Writing Center'));

      expect(opened, [Uri.parse(writingPage)]);
    });

    testWidgets('a Source that is not an https address is shown but opens nothing', (tester) async {
      final opened = <Uri>[];
      await showCard(
        tester,
        writingCenter(
          sources: [GuidebookSource(url: 'javascript:alert(1)', title: 'Odd page', lastSeenAt: DateTime.utc(2026, 11, 2))],
        ),
        openPhone: (address) async {
          opened.add(address);
          return true;
        },
      );

      expect(find.text('Source: Odd page'), findsOneWidget);
      await tester.tap(find.text('Source: Odd page'));
      await tester.pump();
      expect(opened, isEmpty);
    });

    testWidgets('the phone number starts a call in the phone app', (tester) async {
      final opened = <Uri>[];
      await showCard(tester, writingCenter(phone: '(215) 204-0702', phoneToDial: '+12152040702'), openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tapThrough(tester, find.text('Call (215) 204-0702'));

      expect(opened, [Uri.parse('tel:+12152040702')]);
    });

    testWidgets('a phone number the dialer cannot use is shown as words', (tester) async {
      await showCard(tester, writingCenter(phone: 'ext. 12'));

      expect(find.text('Phone: ext. 12'), findsOneWidget);
      expect(find.textContaining('Call'), findsNothing);
    });

    testWidgets('the email address opens the mail app', (tester) async {
      final opened = <Uri>[];
      await showCard(tester, writingCenter(email: 'sscdesk@temple.edu'), openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tapThrough(tester, find.text('Email sscdesk@temple.edu'));

      expect(opened, [Uri.parse('mailto:sscdesk@temple.edu')]);
    });

    testWidgets('says so when the phone could not open it', (tester) async {
      await showCard(tester, writingCenter(), openPhone: (address) async => false);

      await tapThrough(tester, find.text('Source: Writing Center'));

      expect(find.textContaining("couldn't open that"), findsOneWidget);
    });
  });

  group('a Report', () {
    testWidgets('asks first, saying what it does', (tester) async {
      final backend = FakeBackend();
      await showCard(tester, writingCenter(), backend: backend);

      await tapThrough(tester, find.text('Report'));

      expect(find.text('Report Writing Center?'), findsOneWidget);
      expect(find.textContaining('every Student'), findsOneWidget);
      expect(backend.reported, isEmpty);
    });

    testWidgets('does nothing if the Student cancels', (tester) async {
      final backend = FakeBackend();
      await showCard(tester, writingCenter(), backend: backend);

      await tapThrough(tester, find.text('Report'));
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(backend.reported, isEmpty);
      expect(find.text('Writing Center'), findsOneWidget);
    });

    testWidgets('hides every card of the item at once, and says so', (tester) async {
      final backend = FakeBackend()
        ..history = [GuidebookCardItem(writingCenter()), GuidebookCardItem(writingCenter()), buddy('Try this.')];
      tester.view
        ..physicalSize = const Size(412, 1800)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await openUnlockedApp(tester, backend);

      await tapThrough(tester, find.text('Report').first);
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(backend.reported, [7]);
      expect(find.text('Writing Center'), findsNothing);
      expect(find.textContaining('You reported this'), findsNWidgets(2));
    });

    testWidgets('keeps the card and says so when it can not reach the backend', (tester) async {
      final backend = FakeBackend()..reportError = const BackendException('offline');
      await showCard(tester, writingCenter(), backend: backend);

      await tapThrough(tester, find.text('Report'));
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(find.text('Writing Center'), findsOneWidget);
      expect(find.textContaining("couldn't send your Report"), findsOneWidget);
    });
  });

  group('a card whose item has gone', () {
    testWidgets('says so in place of the card', (tester) async {
      await openUnlockedApp(tester, FakeBackend()..history = [GuidebookCardItem(null)]);

      expect(find.textContaining('no longer shows this card'), findsOneWidget);
      expect(find.text('Report'), findsNothing);
    });
  });

  group('during a reply', () {
    testWidgets('a card appears as soon as it comes, and sits under the finished reply', (tester) async {
      final backend = FakeBackend();
      tester.view
        ..physicalSize = const Size(412, 915)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Help with my essay?');

      backend.reply.add(ReplyGuidebookCard(writingCenter()));
      await tester.pump();
      expect(find.text('Writing Center'), findsOneWidget);

      backend.reply.add(ReplyDone(buddy('Try this.')));
      await backend.reply.close();
      await tester.pumpAndSettle();

      final cardAt = tester.getTopLeft(find.text('Writing Center')).dy;
      final replyAt = tester.getTopLeft(find.text('Try this.')).dy;
      expect(cardAt, greaterThan(replyAt));
    });

    testWidgets('a screen reader hears a new card, but not one loaded from history', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..history = [GuidebookCardItem(writingCenter(id: 1))];
      tester.view
        ..physicalSize = const Size(412, 1800)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await openUnlockedApp(tester, backend);

      expect(tester.getSemantics(find.text('Writing Center')).flagsCollection.isLiveRegion, isFalse);

      await sendMessage(tester, 'And another?');
      backend.reply.add(
        ReplyGuidebookCard(
          GuidebookItem(id: 2, name: 'Coaching', summary: 'Helps.', sources: writingCenter().sources),
        ),
      );
      await tester.pump();

      expect(find.bySemanticsLabel(RegExp('Guidebook card: Coaching')), findsOneWidget);
      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('Guidebook card: Coaching')));
      expect(node.flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });
  });

  group('with a screen reader and larger text', () {
    testWidgets('hears what the card says as one item, and a clear label on each button', (tester) async {
      final handle = tester.ensureSemantics();
      await showCard(tester, writingCenter(phone: '(215) 204-0702', phoneToDial: '+12152040702', email: 'a@temple.edu'));

      expect(find.bySemanticsLabel(RegExp(r'^Guidebook card: Writing Center\. Student writers help student writers\.\s+Free')), findsOneWidget);
      expect(find.bySemanticsLabel('Call Writing Center at (215) 204-0702'), findsOneWidget);
      expect(find.bySemanticsLabel('Email Writing Center at a@temple.edu'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp(r'^Open Source: Writing Center \| Student Success Center, last seen .*November 2, 2026')),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('Report Writing Center as wrong or out of date'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('hears a failed Report when it happens', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..reportError = const BackendException('offline');
      await showCard(tester, writingCenter(), backend: backend);

      await tapThrough(tester, find.text('Report'));
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(tester.getSemantics(find.textContaining("couldn't send your Report")).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('everything fits at twice the text size on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openUnlockedApp(
        tester,
        FakeBackend()
          ..history = [
            student('Help?'),
            GuidebookCardItem(
              writingCenter(
                cost: "There's a fee, but its Source doesn't say how much. Ask before you sign up.",
                phone: '(215) 204-0702',
                phoneToDial: '+12152040702',
                email: 'a-very-long-address-for-a-writing-center@temple.edu',
                place: 'Charles Library 230, 1900 N 13th Street, Philadelphia, PA 19122',
                hours: 'Monday-Thursday: 8:30AM–8:30PM; Friday: 8:30AM–4:30PM',
              ),
            ),
          ],
      );
      expect(tester.takeException(), isNull, reason: 'overflow on the card');

      await tester.ensureVisible(find.text('Report'));
      await tester.pumpAndSettle();
      expect(find.text('Report').hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull, reason: 'overflow further down');

      await tester.tap(find.text('Report'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull, reason: 'overflow on the dialog');
      expect(find.text('Cancel').hitTestable(), findsOneWidget);
    });
  });

  group('the real backend client', () {
    final itemJson = {
      'id': 7,
      'kind': 'resource',
      'name': 'Writing Center',
      'summary': 'Helps.',
      'cost': 'Free',
      'phone': '(215) 204-0702',
      'phoneToDial': '+12152040702',
      'email': 'a@temple.edu',
      'place': 'Charles Library',
      'hours': 'Mon',
      'sources': [
        {'url': writingPage, 'title': 'Writing Center', 'lastSeenAt': '2026-11-02T14:00:00.000Z'},
      ],
    };

    HttpBuddyBackend clientWith(MockClient client) => HttpBuddyBackend(
          Uri.parse('http://backend.test'),
          deviceKey: 'the-key',
          onKeyRefused: () {},
          client: client,
        );

    test('reads a card and a gone card from history', () async {
      final backend = clientWith(
        MockClient(
          (request) async => http.Response(
            jsonEncode({
              'opening': null,
              'messages': [
                {'type': 'guidebook_card', 'item': itemJson, 'sentAt': '2026-11-02T14:00:00.000Z'},
                {'type': 'guidebook_card', 'item': null, 'sentAt': '2026-11-02T14:00:00.000Z'},
              ],
            }),
            200,
          ),
        ),
      );

      final [card, gone] = await backend.loadHistory();

      final item = (card as GuidebookCardItem).item!;
      expect(item.name, 'Writing Center');
      expect(item.cost, 'Free');
      expect(item.phoneToDial, '+12152040702');
      expect(item.sources.single.url, writingPage);
      expect(item.sources.single.lastSeenAt, DateTime.utc(2026, 11, 2, 14));
      expect((gone as GuidebookCardItem).item, isNull);
    });

    test('reads a card as it arrives in a reply', () async {
      final backend = clientWith(
        MockClient.streaming(
          (request, body) async => http.StreamedResponse(
            Stream.value(utf8.encode('data: ${jsonEncode({'type': 'guidebook_card', 'item': itemJson})}\n\n')),
            200,
          ),
        ),
      );

      final [event] = await backend.send('Help').toList();

      expect((event as ReplyGuidebookCard).item.name, 'Writing Center');
    });

    test('sends a Report with the device key, and takes an item already gone as done', () async {
      final seen = <http.Request>[];
      var status = 204;
      final backend = clientWith(
        MockClient((request) async {
          seen.add(request);
          return http.Response('', status);
        }),
      );

      await backend.reportGuidebookItem(7);
      status = 404;
      await backend.reportGuidebookItem(8);

      expect(seen.first.method, 'POST');
      expect(seen.first.url.path, '/guidebook/items/7/report');
      expect(seen.first.headers['authorization'], 'Bearer the-key');
    });

    test('throws when a Report fails', () async {
      final backend = clientWith(MockClient((request) async => http.Response('', 500)));

      await expectLater(backend.reportGuidebookItem(7), throwsA(isA<BackendException>()));
    });
  });
}
