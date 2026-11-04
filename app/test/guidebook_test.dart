import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

GuidebookSource source(String title, {String? url}) =>
    GuidebookSource(url: url ?? 'https://www.temple.edu/${title.replaceAll(' ', '-')}', title: title, lastSeenAt: DateTime(2026, 11, 3));

final writingCenter = GuidebookItem(
  id: 1,
  name: 'Writing Center',
  summary: 'Student writers work with other student writers on any type of writing.',
  cost: 'Free',
  place: 'Charles Library',
  hours: 'Monday to Friday',
  sources: [source('Writing Center page')],
);
final counseling = GuidebookItem(
  id: 2,
  name: 'Tuttleman Counseling Services',
  summary: 'Counseling for enrolled students.',
  cost: 'Free',
  phone: '(215) 204-7276',
  phoneToDial: '+12152047276',
  sources: [source('Tuttleman page')],
);
final sfs = GuidebookItem(
  id: 3,
  isContact: true,
  name: 'Student Financial Services',
  summary: 'Help with bills and holds.',
  email: 'sfs@temple.edu',
  sources: [source('SFS page')],
);
final jobsFair = Opportunity(
  id: 9,
  name: 'Campus jobs fair',
  summary: 'Employers hiring on campus.',
  when: 'November 18, 2026',
  cost: 'Free',
  outsideTemple: false,
  saved: false,
  sources: [source('Careers page')],
);

FakeBackend aGuidebook() => FakeBackend(history: [student('Hello')])
  ..guidebook = [writingCenter, counseling, sfs]
  ..opportunities = [jobsFair];

Future<void> openGuidebook(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend, leftToItself: true);
  await goToTab(tester, 'Today');
  await settleApp(tester);
  await tester.tap(find.text('Guidebook'));
  await tester.pumpAndSettle();
}

void main() {
  group('from the Today tab', () {
    testWidgets('opens on the Resources, each with its Source and cost', (tester) async {
      await openGuidebook(tester, aGuidebook());

      expect(find.text('Writing Center'), findsOneWidget);
      expect(find.text('Tuttleman Counseling Services'), findsOneWidget);
      expect(find.text('Free'), findsNWidgets(2));
      expect(find.text('Source: Writing Center page'), findsOneWidget);
      expect(find.text('Student Financial Services'), findsNothing);
    });

    testWidgets('says how much is on each shelf, and moves between them', (tester) async {
      await openGuidebook(tester, aGuidebook());

      expect(find.text('Resources 2'), findsOneWidget);
      expect(find.text('Opportunities 1'), findsOneWidget);
      expect(find.text('Contacts 1'), findsOneWidget);

      await tester.tap(find.text('Contacts 1'));
      await tester.pump();
      expect(find.text('Student Financial Services'), findsOneWidget);
      expect(find.text('Writing Center'), findsNothing);

      await tester.tap(find.text('Opportunities 1'));
      await tester.pump();
      expect(find.text('Campus jobs fair'), findsOneWidget);
      expect(find.text('At Temple'), findsOneWidget);
    });

    testWidgets('See Opportunities goes straight to the Opportunities', (tester) async {
      await openUnlockedApp(tester, aGuidebook(), leftToItself: true);
      await tester.dragUntilVisible(find.text('See Opportunities'), find.byType(ListView).first, const Offset(0, -200));
      await tester.tap(find.text('See Opportunities'));
      await tester.pumpAndSettle();

      expect(find.text('Guidebook'), findsOneWidget);
      expect(find.text('Campus jobs fair'), findsOneWidget);
      expect(find.text('Writing Center'), findsNothing);
    });

    testWidgets('reads the list again each time it opens', (tester) async {
      final backend = aGuidebook();
      await openGuidebook(tester, backend);
      expect(find.text('Writing Center'), findsOneWidget);

      backend.guidebook = [counseling];
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.text('Guidebook'));
      await tester.pumpAndSettle();

      expect(find.text('Writing Center'), findsNothing);
      expect(find.text('Tuttleman Counseling Services'), findsOneWidget);
    });
  });

  group('searching', () {
    testWidgets('narrows every shelf, and each shelf says what it still holds', (tester) async {
      await openGuidebook(tester, aGuidebook());

      await tester.enterText(find.byType(TextField), 'bills');
      await tester.pump();

      expect(find.text('Resources 0'), findsOneWidget);
      expect(find.text('Contacts 1'), findsOneWidget);
      expect(find.text('Opportunities 0'), findsOneWidget);
      expect(find.textContaining('Nothing here matches that'), findsOneWidget);
    });

    testWidgets('goes by every word, in any case, wherever it is in the item', (tester) async {
      await openGuidebook(tester, aGuidebook());

      await tester.enterText(find.byType(TextField), 'CHARLES writers');
      await tester.pump();

      expect(find.text('Writing Center'), findsOneWidget);
      expect(find.text('Tuttleman Counseling Services'), findsNothing);
    });

    testWidgets('clearing it brings everything back', (tester) async {
      await openGuidebook(tester, aGuidebook());

      await tester.enterText(find.byType(TextField), 'nothing like this');
      await tester.pump();
      expect(find.text('Writing Center'), findsNothing);

      await tester.enterText(find.byType(TextField), '');
      await tester.pump();
      expect(find.text('Writing Center'), findsOneWidget);
    });
  });

  group('one item', () {
    Future<void> openCounseling(WidgetTester tester, FakeBackend backend, {PhoneOpener? openPhone}) async {
      await openUnlockedApp(tester, backend, leftToItself: true, openPhone: openPhone ?? pretendToOpenPhone);
      await goToTab(tester, 'Today');
      await settleApp(tester);
      await tester.tap(find.text('Guidebook'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Tuttleman Counseling Services'));
      await tester.pumpAndSettle();
    }

    testWidgets('shows everything known about it, with a way to call', (tester) async {
      await openCounseling(tester, aGuidebook());

      expect(find.text('Tuttleman Counseling Services'), findsOneWidget);
      expect(find.text('Resource'), findsOneWidget);
      expect(find.text('Counseling for enrolled students.'), findsOneWidget);
      expect(find.text('Call (215) 204-7276'), findsOneWidget);
      expect(find.text('Source: Tuttleman page'), findsOneWidget);
    });

    testWidgets('calling opens the phone with the number', (tester) async {
      final opened = <Uri>[];
      await openCounseling(tester, aGuidebook(), openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tester.tap(find.text('Call (215) 204-7276'));
      await tester.pump();

      expect(opened, [Uri.parse('tel:+12152047276')]);
    });

    testWidgets('Ask Buddy goes to the conversation and asks about it', (tester) async {
      final backend = aGuidebook();
      await openCounseling(tester, backend);

      await tester.ensureVisible(find.text('Ask Buddy about this'));
      await tester.pump();
      await tester.tap(find.text('Ask Buddy about this'));
      await tester.pump();
      // The writing dots keep moving while Buddy replies, so this can't wait for everything to stop.
      await tester.pump(const Duration(seconds: 1));

      expect(backend.sent, ['Tell me about Tuttleman Counseling Services.']);
      expect(find.text('Your Temple guide'), findsOneWidget);
    });

    testWidgets('a Report asks first, then takes it off the list and off any card in the conversation', (tester) async {
      final backend = aGuidebook()..history = [student('Hello'), GuidebookCardItem(counseling)];
      await openCounseling(tester, backend);

      await tester.ensureVisible(find.text('Report'));
      await tester.pump();
      await tester.tap(find.text('Report'));
      await tester.pumpAndSettle();
      expect(find.text('Report Tuttleman Counseling Services?'), findsOneWidget);
      expect(backend.reported, isEmpty);

      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(backend.reported, [2]);
      expect(find.text('Tuttleman Counseling Services'), findsNothing);
      expect(find.text('Writing Center'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      await goToTab(tester, 'Buddy');
      await settleApp(tester);
      expect(find.text('You reported this, so Buddy no longer shows it to any Student.'), findsOneWidget);
    });

    testWidgets('a Report that fails says so and changes nothing', (tester) async {
      final backend = aGuidebook()..reportError = Exception('no backend');
      await openCounseling(tester, backend);

      await tester.ensureVisible(find.text('Report'));
      await tester.pump();
      await tester.tap(find.text('Report'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(find.textContaining("Buddy couldn't send your Report"), findsOneWidget);
      expect(find.text('Tuttleman Counseling Services'), findsOneWidget);
    });
  });

  group('when there is nothing to show', () {
    testWidgets('says what will come and how', (tester) async {
      await openGuidebook(tester, FakeBackend(history: [student('Hello')]));

      expect(find.textContaining("Nothing here yet. Buddy reads Temple's office pages each day"), findsOneWidget);
    });

    testWidgets('says so when it cannot load, and can try again', (tester) async {
      final backend = aGuidebook()..guidebookError = Exception('no backend');
      await openGuidebook(tester, backend);

      expect(find.textContaining("Buddy couldn't load the Guidebook"), findsOneWidget);

      backend.guidebookError = null;
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Writing Center'), findsOneWidget);
    });
  });

  group('for everyone', () {
    testWidgets('meets the tap target, label and contrast guidelines', (tester) async {
      tester.view
        ..physicalSize = const Size(412, 915)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final handle = tester.ensureSemantics();
      await openGuidebook(tester, aGuidebook());

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('a screen reader hears what a row is and what its Source does', (tester) async {
      final handle = tester.ensureSemantics();
      await openGuidebook(tester, aGuidebook());

      expect(find.bySemanticsLabel(RegExp(r'^Writing Center\. Student writers')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp(r'^Open Source: Writing Center page, last seen')), findsOneWidget);
      handle.dispose();
    });

    testWidgets('fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 568)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      await openGuidebook(tester, aGuidebook());

      expect(tester.takeException(), isNull);
      await tester.dragUntilVisible(find.text('Contacts 1'), find.byType(ListView).last, const Offset(0, -100));
      await tester.tap(find.text('Contacts 1'));
      await tester.pump();
      expect(tester.takeException(), isNull);
    });
  });
}
