import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:buddy/widgets/buddy_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const eventPage = 'https://now.temple.edu/events/2026-11-10/flu-clinic';
const eventTitle = 'Flu Shot Clinic | Temple Now';

Opportunity fluClinic({int id = 7, String name = 'Flu Shot Clinic', bool saved = false, String? place, List<GuidebookSource>? sources}) => Opportunity(
      id: id,
      name: name,
      summary: 'A free flu shot.',
      when: 'Tuesday, November 10, 2026, 12:00 pm to 1:00 pm',
      cost: 'Free',
      outsideTemple: false,
      place: place,
      saved: saved,
      sources: sources ?? [GuidebookSource(url: eventPage, title: eventTitle, lastSeenAt: DateTime.utc(2026, 11, 2, 14))],
    );

Opportunity nursingCamp({int id = 8, bool saved = false}) => Opportunity(
      id: id,
      name: 'Summer Nursing Camp',
      summary: 'A week of hospital visits.',
      when: 'Apply by Tuesday, December 1, 2026',
      cost: 'Costs \$150 for the week',
      worthItBecause: 'You shadow working nurses for a week.',
      outsideTemple: true,
      forGoals: const ['Get into nursing school'],
      saved: saved,
      sources: [GuidebookSource(url: 'https://www.camp.example/summer', title: 'Summer Camp', lastSeenAt: DateTime.utc(2026, 11, 2, 14))],
    );

Future<void> openToday(WidgetTester tester, FakeBackend backend, {PhoneOpener openPhone = pretendToOpenPhone}) async {
  await openUnlockedApp(tester, backend, openPhone: openPhone);
  await tester.tap(find.descendant(of: find.byType(BuddyNavBar), matching: find.text('Today')));
  await tester.pumpAndSettle();
}

Future<void> openOpportunities(WidgetTester tester, FakeBackend backend, {PhoneOpener openPhone = pretendToOpenPhone}) async {
  await openToday(tester, backend, openPhone: openPhone);
  await tester.scrollUntilVisible(find.text('See Opportunities'), 200);
  await tapThrough(tester, find.text('See Opportunities'));
}

/// The Guidebook's own list. Its search field scrolls as well, so a test has to say which.
final guidebookList = find.byType(Scrollable).first;

void useSmallPhoneWithLargeText(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(320, 568)
    ..devicePixelRatio = 1;
  tester.platformDispatcher.textScaleFactorTestValue = 2;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
}

void useTallPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 2000)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> tapThrough(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  group('the Opportunities screen', () {
    testWidgets("shows Temple's first, then those outside Temple under their own heading and with their own label", (tester) async {
      useTallPhone(tester);
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic(), nursingCamp()]);

      final temple = tester.getTopLeft(find.text('Flu Shot Clinic')).dy;
      final outside = tester.getTopLeft(find.text('Summer Nursing Camp')).dy;
      final heading = tester.getTopLeft(find.text("These aren't Temple's own, so check each one's Source before you sign up.")).dy;
      expect(find.text('At Temple'), findsOneWidget);
      expect(temple, lessThan(heading));
      expect(heading, lessThan(outside));
      // Its section's heading, and the card's own label.
      expect(find.text('Outside Temple'), findsNWidgets(2));
    });

    testWidgets('shows the date, what it costs, why a fee is worth it, the Goal and the Source', (tester) async {
      useTallPhone(tester);
      await openOpportunities(tester, FakeBackend()..opportunities = [nursingCamp()]);

      expect(find.text('Apply by Tuesday, December 1, 2026'), findsOneWidget);
      expect(find.text('Costs \$150 for the week'), findsOneWidget);
      expect(find.text('Why it may be worth it: You shadow working nurses for a week.'), findsOneWidget);
      expect(find.text('For your Goal: Get into nursing school'), findsOneWidget);
      expect(find.text('Source: Summer Camp'), findsOneWidget);
    });

    testWidgets('has no heading for a section with nothing in it', (tester) async {
      useTallPhone(tester);
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic()]);

      expect(find.text('Outside Temple'), findsNothing);
    });

    testWidgets('says what to expect when there is nothing yet', (tester) async {
      await openOpportunities(tester, FakeBackend());

      expect(find.textContaining('Nothing to show yet.'), findsOneWidget);
    });

    testWidgets('says so when it cannot load, and can try again', (tester) async {
      final backend = FakeBackend()..opportunitiesError = Exception('off');
      await openOpportunities(tester, backend);
      expect(find.textContaining("couldn't load these"), findsOneWidget);

      backend
        ..opportunitiesError = null
        ..opportunities = [fluClinic()];
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Flu Shot Clinic'), findsOneWidget);
    });

    testWidgets('shows ten at a time', (tester) async {
      useTallPhone(tester);
      await openOpportunities(
        tester,
        FakeBackend()..opportunities = [for (var id = 1; id <= 11; id++) fluClinic(id: id, name: 'Event number $id')],
      );

      await tester.scrollUntilVisible(find.text('Show 1 more'), 300, scrollable: guidebookList);
      expect(find.text('Event number 11'), findsNothing);
      await tapThrough(tester, find.text('Show 1 more'));
      await tester.scrollUntilVisible(find.text('Event number 11'), 300, scrollable: guidebookList);
      expect(find.text('Event number 11'), findsOneWidget);
      expect(find.textContaining('more'), findsNothing);
    });

    testWidgets('a Source opens its page', (tester) async {
      useTallPhone(tester);
      final opened = <Uri>[];
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic()], openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tester.tap(find.text('Source: Flu Shot Clinic'));
      await tester.pumpAndSettle();

      expect(opened, [Uri.parse(eventPage)]);
    });

    testWidgets('says so when the phone cannot open a Source', (tester) async {
      useTallPhone(tester);
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic()], openPhone: (address) async => false);

      await tester.tap(find.text('Source: Flu Shot Clinic'));
      await tester.pumpAndSettle();

      expect(find.text("Your phone couldn't open that."), findsOneWidget);
    });

    testWidgets('a Source that is not https cannot be tapped', (tester) async {
      useTallPhone(tester);
      await openOpportunities(
        tester,
        FakeBackend()
          ..opportunities = [
            fluClinic(sources: [GuidebookSource(url: 'http://now.temple.edu/x', title: 'Plain', lastSeenAt: DateTime.utc(2026, 11, 2))]),
          ],
      );

      final link = tester.widget<InkWell>(find.ancestor(of: find.text('Source: Plain'), matching: find.byType(InkWell)));
      expect(link.onTap, isNull);
    });
  });

  group('saving', () {
    testWidgets('a saved Opportunity shows in Today, and goes when it is unsaved', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()..opportunities = [fluClinic()];
      await openOpportunities(tester, backend);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(backend.savedTaps, [(7, true)]);
      expect(find.text('Saved. Tap to remove'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Saved Opportunities'), findsOneWidget);
      expect(find.text('Flu Shot Clinic'), findsOneWidget);

      await tester.tap(find.text('Saved. Tap to remove'));
      await tester.pumpAndSettle();
      expect(backend.savedTaps.last, (7, false));
      expect(find.text('Saved Opportunities'), findsNothing);
      expect(find.text('Flu Shot Clinic'), findsNothing);
    });

    testWidgets('Today shows nothing about saving before anything is saved', (tester) async {
      await openToday(tester, FakeBackend()..opportunities = [fluClinic()]);

      expect(find.text('Saved Opportunities'), findsNothing);
      expect(find.text('Flu Shot Clinic'), findsNothing);
      expect(find.text('See Opportunities'), findsOneWidget);
    });

    testWidgets('shows what was saved even if the dates cannot load', (tester) async {
      await openToday(
        tester,
        FakeBackend()
          ..upcomingError = Exception('off')
          ..opportunities = [fluClinic(saved: true)],
      );

      expect(find.text('Flu Shot Clinic'), findsOneWidget);
      await tester.scrollUntilVisible(find.textContaining("couldn't load what's coming up"), 200);
      expect(find.textContaining("couldn't load what's coming up"), findsOneWidget);
    });

    testWidgets('puts the card back and says so when saving fails', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend()
        ..opportunities = [fluClinic()]
        ..saveOpportunityError = Exception('off');
      await openOpportunities(tester, backend);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(find.text('Save'), findsOneWidget);
      expect(find.textContaining("Buddy couldn't change that."), findsOneWidget);
    });

    testWidgets('a tap on one card shows on the same Opportunity in the conversation', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend(history: [OpportunityCardItem(fluClinic())])..opportunities = [fluClinic()];
      await openUnlockedApp(tester, backend);
      expect(find.text('Save'), findsOneWidget);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();

      expect(find.text('Saved. Tap to remove'), findsOneWidget);
      expect(backend.savedTaps, [(7, true)]);
    });
  });

  group('reporting', () {
    testWidgets('asks first, then hides it and says so', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend(history: [OpportunityCardItem(fluClinic())])..opportunities = [fluClinic()];
      await openUnlockedApp(tester, backend);

      await tester.tap(find.text('Report'));
      await tester.pumpAndSettle();
      expect(find.text('Report Flu Shot Clinic?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(backend.reportedOpportunities, isEmpty);

      await tester.tap(find.text('Report'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(backend.reportedOpportunities, [7]);
      expect(find.text('Flu Shot Clinic'), findsNothing);
      expect(find.textContaining('You reported this'), findsOneWidget);
    });

    testWidgets('says so when the Report does not get there', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend(history: [OpportunityCardItem(fluClinic())])
        ..opportunities = [fluClinic()]
        ..reportOpportunityError = Exception('off');
      await openUnlockedApp(tester, backend);

      await tester.tap(find.text('Report'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(find.textContaining("Buddy couldn't send your Report."), findsOneWidget);
      expect(find.text('Flu Shot Clinic'), findsOneWidget);
    });
  });

  group('in the conversation', () {
    testWidgets('shows the card with its Source, and a note in place of one that has gone', (tester) async {
      useTallPhone(tester);
      await openUnlockedApp(tester, FakeBackend(history: [OpportunityCardItem(fluClinic()), OpportunityCardItem(null)]));

      expect(find.text('Source: Flu Shot Clinic'), findsOneWidget);
      expect(find.textContaining('Buddy no longer shows this'), findsOneWidget);
    });

    testWidgets('a card arriving in a reply appears', (tester) async {
      useTallPhone(tester);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Any flu shots?');

      backend.reply.add(ReplyOpportunityCard(fluClinic()));
      await tester.pump();

      expect(find.text('Flu Shot Clinic'), findsOneWidget);
      await backend.reply.close();
      await tester.pumpAndSettle();
    });
  });

  group('with a screen reader', () {
    testWidgets('reads each card as one item, saying when it is outside Temple, what it costs and why', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openOpportunities(tester, FakeBackend()..opportunities = [nursingCamp()]);

      expect(
        find.bySemanticsLabel(
          'Opportunity: Summer Nursing Camp. Outside Temple. A week of hospital visits. Apply by Tuesday, December 1, 2026. Costs \$150 for the week. '
          'Why it may be worth it: You shadow working nurses for a week. For your Goal: Get into nursing school.',
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('names what each button is for', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic()]);

      expect(find.bySemanticsLabel('Save Flu Shot Clinic'), findsOneWidget);
      expect(find.bySemanticsLabel('Report Flu Shot Clinic as wrong or out of date'), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Open Source: Flu Shot Clinic \| Temple Now, last seen ')), findsOneWidget);

      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(find.bySemanticsLabel('Remove Flu Shot Clinic from what you saved'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('marks each section as a heading', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic(), nursingCamp()]);

      for (final heading in ['At Temple', 'Outside Temple']) {
        final node = tester.getSemantics(find.text(heading).first);
        expect(node.flagsCollection.isHeader, isTrue, reason: heading);
      }
      handle.dispose();
    });

    testWidgets('reads out a problem as it appears', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openOpportunities(tester, FakeBackend()..opportunitiesError = Exception('off'));

      final node = tester.getSemantics(find.textContaining("couldn't load these"));
      expect(node.flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('meets the tap target, label and contrast guidelines on the screen and on Today', (tester) async {
      tester.view
        ..physicalSize = const Size(412, 915)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final handle = tester.ensureSemantics();
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic(saved: true), nursingCamp()]);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));

      await tester.pageBack();
      await tester.pumpAndSettle();
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });

  group('with larger text on a small phone', () {
    testWidgets('nothing overflows on the screen, and every control can be reached', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openOpportunities(tester, FakeBackend()..opportunities = [fluClinic(place: 'Conwell Hall / 1801 N. Broad Street / Philadelphia / PA / 19122'), nursingCamp()]);
      expect(tester.takeException(), isNull);

      await tester.scrollUntilVisible(find.text('Summer Nursing Camp'), 200, scrollable: guidebookList);
      expect(tester.takeException(), isNull);
      await tapThrough(tester, find.text('Save').last);
      expect(tester.takeException(), isNull);
      expect(find.text('Saved. Tap to remove'), findsOneWidget);
    });

    testWidgets('nothing overflows on Today with what was saved', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openToday(tester, FakeBackend()..opportunities = [fluClinic(saved: true), nursingCamp(saved: true)]);

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('See Opportunities'), 200);
      expect(tester.takeException(), isNull);
      await tapThrough(tester, find.text('See Opportunities'));
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('At Temple'), 200, scrollable: guidebookList);
      expect(find.text('At Temple'), findsOneWidget);
    });
  });

  group('the calls to the backend', () {
    final opportunityJson = {
      'id': 7,
      'name': 'Flu Shot Clinic',
      'summary': 'A free flu shot.',
      'when': 'Tuesday, November 10, 2026',
      'date': '2026-11-10',
      'endDate': null,
      'cost': 'Free',
      'worthItBecause': null,
      'outsideTemple': false,
      'place': null,
      'forGoals': ['A Goal'],
      'saved': true,
      'sources': [
        {'url': eventPage, 'title': eventTitle, 'lastSeenAt': '2026-11-02T14:00:00.000Z'},
      ],
    };

    HttpBuddyBackend backendAnswering(Future<http.Response> Function(http.Request request) answer) =>
        HttpBuddyBackend(Uri.parse('http://backend.test'), deviceKey: 'a-key', onKeyRefused: () {}, client: MockClient(answer));

    test('loads the list', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/opportunities');
        return http.Response(jsonEncode({'opportunities': [opportunityJson]}), 200);
      });

      final [opportunity] = await backend.loadOpportunities();

      expect(opportunity.name, 'Flu Shot Clinic');
      expect(opportunity.saved, isTrue);
      expect(opportunity.forGoals, ['A Goal']);
      expect(opportunity.sources.single.url, eventPage);
    });

    test('saves with PUT and unsaves with DELETE', () async {
      final asked = <String>[];
      final backend = backendAnswering((request) async {
        asked.add('${request.method} ${request.url.path}');
        return http.Response('', 204);
      });

      await backend.setOpportunitySaved(7, true);
      await backend.setOpportunitySaved(7, false);

      expect(asked, ['PUT /opportunities/7/saved', 'DELETE /opportunities/7/saved']);
    });

    test('a failed save throws, and a Report on something already gone does not', () async {
      final backend = backendAnswering((request) async => http.Response('', request.method == 'POST' ? 404 : 500));

      await expectLater(backend.setOpportunitySaved(7, true), throwsA(isA<BackendException>()));
      await backend.reportOpportunity(7);
    });

    test('reads a card from the history, and one that has gone', () async {
      final backend = backendAnswering((request) async => http.Response(
            jsonEncode({
              'messages': [
                {'type': 'opportunity_card', 'opportunity': opportunityJson, 'sentAt': '2026-11-02T14:00:00.000Z'},
                {'type': 'opportunity_card', 'opportunity': null, 'sentAt': '2026-11-02T14:00:00.000Z'},
              ],
            }),
            200,
          ));

      final items = await backend.loadHistory();

      expect((items[0] as OpportunityCardItem).opportunity?.name, 'Flu Shot Clinic');
      expect((items[1] as OpportunityCardItem).opportunity, isNull);
    });
  });
}
