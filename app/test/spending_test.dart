import 'dart:async';
import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/spending/spending_backend.dart';
import 'package:buddy/spending/spending_section.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const cent = 10000000;
const twoDollars = 200 * cent;
const stoppedWords = 'Background work has stopped for today, because it reached its limit of \$2.00. It resumes tomorrow. Chat, Tasks and Briefings keep working.';

SpendingSummary spent({int today = 0, int month = 0, bool stopped = false}) => SpendingSummary(
      todayNanodollars: today,
      thisMonthNanodollars: month,
      backgroundLimitNanodollars: twoDollars,
      backgroundStoppedForToday: stopped,
    );

const spendingRow = 'What Buddy spent';

/// Goes to the You tab, and brings the row into view. The tab builds only what's near the screen, so on a small phone
/// it isn't there yet.
Future<void> showYouRow(WidgetTester tester) async {
  await goToTab(tester, 'You');
  await settleApp(tester);
  await tester.dragUntilVisible(find.text(spendingRow), find.byType(ListView).last, const Offset(0, -200));
  await tester.pump();
}

/// Opens the screen from its row. This doesn't wait for everything to settle, because a spinner never does.
Future<void> tapYouRow(WidgetTester tester) async {
  await tester.tap(find.text(spendingRow));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump();
}

Future<void> openSpending(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend);
  await showYouRow(tester);
  await tapYouRow(tester);
}

/// From the screen to another tab and back to You, which is what makes the app load the amounts again.
Future<void> leaveAndComeBack(WidgetTester tester) async {
  await tester.pageBack();
  await tester.pumpAndSettle();
  await goToTab(tester, 'Today');
  await settleApp(tester);
  await showYouRow(tester);
}

/// An amount, in the row that says which period it's for.
Finder amount(String period, String money) => find.descendant(
      of: find.ancestor(of: find.text(period), matching: find.byType(Wrap)),
      matching: find.text(money),
    );

Finder inSpending(Finder finder) => find.descendant(of: find.byType(SpendingScreen), matching: finder);

/// A screen reader's tree holds only what's on the screen, and on this all of the You tab is.
void useTallPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 4000)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
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
  group('how money reads', () {
    test('on the screen, to the cent', () {
      expect(moneyOnScreen(0), r'$0.00');
      expect(moneyOnScreen(5000000), r'$0.01');
      expect(moneyOnScreen(42 * cent), r'$0.42');
      expect(moneyOnScreen(150 * cent), r'$1.50');
      expect(moneyOnScreen(twoDollars), r'$2.00');
      expect(moneyOnScreen(1234 * cent), r'$12.34');
    });

    test('says so when there is some, but too little to show as a cent', () {
      expect(moneyOnScreen(1), 'less than 1 cent');
      expect(moneyOnScreen(4999999), 'less than 1 cent');
      expect(moneyAloud(4999999), 'less than 1 cent');
    });

    test('aloud, in the words a person would use', () {
      expect(moneyAloud(0), '0 dollars');
      expect(moneyAloud(cent), '1 cent');
      expect(moneyAloud(42 * cent), '42 cents');
      expect(moneyAloud(100 * cent), '1 dollar');
      expect(moneyAloud(twoDollars), '2 dollars');
      expect(moneyAloud(101 * cent), '1 dollar and 1 cent');
      expect(moneyAloud(310 * cent), '3 dollars and 10 cents');
    });
  });

  group('the row on the You tab', () {
    testWidgets("shows today's spend", (tester) async {
      await openUnlockedApp(tester, FakeBackend()..spendingSummary = spent(today: 42 * cent, month: 310 * cent));
      await showYouRow(tester);

      expect(find.text(r'Today: $0.42'), findsOneWidget);
    });

    testWidgets('says what the screen holds until the backend answers', (tester) async {
      final backend = FakeBackend()..holdSpending = Completer<void>();
      await openUnlockedApp(tester, backend);
      await showYouRow(tester);

      expect(find.text('Usage and limits'), findsOneWidget);
      expect(find.textContaining('Today:'), findsNothing);

      backend.holdSpending!.complete();
      await settleApp(tester);
      expect(find.text(r'Today: $0.00'), findsOneWidget);
    });

    testWidgets('keeps showing what it knows if a later refresh fails', (tester) async {
      final backend = FakeBackend()..spendingSummary = spent(today: 42 * cent);
      await openSpending(tester, backend);

      backend.spendingError = Exception('made up');
      await leaveAndComeBack(tester);

      expect(find.text(r'Today: $0.42'), findsOneWidget);
    });

    testWidgets('loads again each time the You tab opens, because the amounts keep changing', (tester) async {
      final backend = FakeBackend()..spendingSummary = spent(today: 42 * cent);
      await openSpending(tester, backend);

      backend.spendingSummary = spent(today: 50 * cent);
      await leaveAndComeBack(tester);

      expect(find.text(r'Today: $0.50'), findsOneWidget);
    });
  });

  group('the screen', () {
    testWidgets("shows today's and this month's spend", (tester) async {
      await openSpending(tester, FakeBackend()..spendingSummary = spent(today: 42 * cent, month: 310 * cent));

      expect(amount('Today', r'$0.42'), findsOneWidget);
      expect(amount('This month', r'$3.10'), findsOneWidget);
    });

    testWidgets('says what the limit is while background work is going', (tester) async {
      await openSpending(tester, FakeBackend()..spendingSummary = spent(today: 42 * cent, month: 42 * cent));

      expect(find.text('Background work stops for the day if it reaches \$2.00. Chat has no limit.'), findsOneWidget);
      expect(find.text(stoppedWords), findsNothing);
    });

    testWidgets('says plainly when background work has stopped for today, and that it resumes tomorrow', (tester) async {
      await openSpending(tester, FakeBackend()..spendingSummary = spent(today: twoDollars, month: twoDollars, stopped: true));

      expect(amount('Today', r'$2.00'), findsOneWidget);
      expect(find.text(stoppedWords), findsOneWidget);
    });

    testWidgets('shows that it is loading until the backend answers', (tester) async {
      final backend = FakeBackend()..holdSpending = Completer<void>();
      await openSpending(tester, backend);

      expect(inSpending(find.byType(CircularProgressIndicator)), findsOneWidget);
      expect(inSpending(find.text('Today')), findsNothing);

      backend.holdSpending!.complete();
      await settleApp(tester);
      expect(amount('Today', r'$0.00'), findsOneWidget);
    });

    testWidgets('says when it could not load, and tries again', (tester) async {
      final backend = FakeBackend()..spendingError = Exception('made up');
      await openSpending(tester, backend);

      expect(inSpending(find.textContaining("can't reach Buddy")), findsOneWidget);
      expect(inSpending(find.text('Today')), findsNothing);

      backend
        ..spendingError = null
        ..spendingSummary = spent(today: 42 * cent);
      await tester.tap(inSpending(find.text('Try again')));
      await settleApp(tester);

      expect(amount('Today', r'$0.42'), findsOneWidget);
    });

    testWidgets('keeps showing what it knows if a later refresh fails', (tester) async {
      final backend = FakeBackend()..spendingSummary = spent(today: 42 * cent);
      await openSpending(tester, backend);

      backend.spendingError = Exception('made up');
      await leaveAndComeBack(tester);
      await tapYouRow(tester);

      expect(amount('Today', r'$0.42'), findsOneWidget);
    });

    testWidgets('shows the new amounts after the You tab has loaded them again', (tester) async {
      final backend = FakeBackend()..spendingSummary = spent(today: 42 * cent);
      await openSpending(tester, backend);

      backend.spendingSummary = spent(today: 50 * cent);
      await leaveAndComeBack(tester);
      await tapYouRow(tester);

      expect(amount('Today', r'$0.50'), findsOneWidget);
    });
  });

  group('for a screen reader', () {
    testWidgets('the screen has a heading', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openSpending(tester, FakeBackend());

      expect(tester.getSemantics(find.text('What Buddy spent')).flagsCollection.isHeader, isTrue);
      handle.dispose();
    });

    testWidgets('the row on the You tab reads the amount as words', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend()..spendingSummary = spent(today: 42 * cent));
      await showYouRow(tester);

      expect(find.bySemanticsLabel('What Buddy spent. Today: 42 cents'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('reads amounts as words', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openSpending(tester, FakeBackend()..spendingSummary = spent(today: 42 * cent, month: 310 * cent));

      expect(find.bySemanticsLabel('Today: 42 cents'), findsOneWidget);
      expect(find.bySemanticsLabel('This month: 3 dollars and 10 cents'), findsOneWidget);
      expect(find.bySemanticsLabel('Background work stops for the day if it reaches 2 dollars. Chat has no limit.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('announces that background work has stopped, with the limit as words', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openSpending(tester, FakeBackend()..spendingSummary = spent(today: twoDollars, month: twoDollars, stopped: true));

      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('^Background work has stopped for today')));
      expect(node.label, 'Background work has stopped for today, because it reached its limit of 2 dollars. It resumes tomorrow. Chat, Tasks and Briefings keep working.');
      expect(node.flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('labels its loading', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..holdSpending = Completer<void>();
      await openSpending(tester, backend);
      final spinner = inSpending(find.byType(CircularProgressIndicator));
      expect(tester.widget<CircularProgressIndicator>(spinner).semanticsLabel, 'Loading what Buddy spent');
      backend.holdSpending!.complete();
      await settleApp(tester);
      handle.dispose();
    });

    testWidgets('says what its Try again is for, since other screens have one', (tester) async {
      useTallPhone(tester);
      final handle = tester.ensureSemantics();
      await openSpending(tester, FakeBackend()..spendingError = Exception('made up'));

      expect(find.bySemanticsLabel('Try loading what Buddy spent again'), findsOneWidget);
      handle.dispose();
    });
  });

  group('at larger text', () {
    testWidgets('nothing is cut off on a small phone', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openSpending(tester, FakeBackend()..spendingSummary = spent(today: twoDollars, month: 123456 * cent, stopped: true));

      expect(tester.takeException(), isNull);
      // Further down than a small phone shows, and what's off the screen can't be found.
      await tester.scrollUntilVisible(find.text(stoppedWords), 200, scrollable: find.byType(Scrollable).first);
      await tester.pump();
      expect(find.text(stoppedWords), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('its error fits too', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openSpending(tester, FakeBackend()..spendingError = Exception('made up'));

      expect(tester.takeException(), isNull);
    });
  });

  group('talking to the backend', () {
    test('reads the amounts, sending the device key', () async {
      final seen = <http.Request>[];
      final backend = HttpBuddyBackend(
        Uri.parse('http://backend.test'),
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          seen.add(request);
          return http.Response(
            jsonEncode({
              'todayNanodollars': 420000000,
              'thisMonthNanodollars': 3100000000,
              'backgroundLimitNanodollars': 2000000000,
              'backgroundStoppedForToday': true,
            }),
            200,
          );
        }),
      );

      final summary = await backend.loadSpending();

      expect(seen.single.url.path, '/spending');
      expect(seen.single.headers['authorization'], 'Bearer the-key');
      expect(summary.todayNanodollars, 420000000);
      expect(summary.thisMonthNanodollars, 3100000000);
      expect(summary.backgroundLimitNanodollars, 2000000000);
      expect(summary.backgroundStoppedForToday, isTrue);
    });

    test('tells the app when the phone is no longer paired', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        Uri.parse('http://backend.test'),
        deviceKey: 'the-key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('{}', 401)),
      );

      await expectLater(backend.loadSpending(), throwsA(isA<BackendException>()));
      expect(refused, isTrue);
    });
  });
}
