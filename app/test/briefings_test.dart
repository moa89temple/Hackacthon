import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/briefings/briefing_backend.dart';
import 'package:buddy/device/app_lock.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/fake_briefings.dart';
import 'support/test_app.dart';

const calendarPage = 'https://registrar.temple.edu/academic-calendar/2026-2027-academic-calendar';
const notSetUp = "Phone notifications aren't set up in this build of the app";

final source = GuidebookSource(url: calendarPage, title: 'Academic Calendar', lastSeenAt: DateTime.utc(2026, 11, 2, 14));

BriefingMilestone standardMilestone({int id = 7, String name = 'Last day to withdraw'}) => BriefingMilestone(
      key: 'standard $id',
      milestone: StandardMilestone(id: id, name: name, term: 'Fall 2026', when: 'Monday, November 30, 2026', passed: false, sources: [source]),
    );

BriefingMilestone goalMilestone() => BriefingMilestone(
      key: 'roadmap 7',
      milestone: const StandardMilestone(id: 7, name: 'Ask for a recommendation', when: 'Wednesday, November 4, 2026', passed: false, sources: []),
      goal: 'Get into PA school',
      sourceNote: 'You added this.',
    );

Opportunity fluClinic() => Opportunity(
      id: 3,
      name: 'Flu Shot Clinic',
      summary: 'A free flu shot.',
      when: 'Tuesday, November 10, 2026',
      cost: 'Free',
      outsideTemple: false,
      saved: false,
      sources: [source],
    );

Briefing aBriefing({
  String title = 'Your Briefing',
  List<BriefingMilestone>? milestones,
  List<Opportunity> opportunities = const [],
  List<BriefingNews> news = const [],
  List<MoreBriefingNews> moreNews = const [],
  bool hadNothing = false,
}) =>
    Briefing(
      title: title,
      when: 'Tuesday, November 3 at 8:00 AM',
      milestones: milestones ?? [standardMilestone()],
      opportunities: opportunities,
      news: news,
      moreNews: moreNews,
      hadNothing: hadNothing,
    );

const hold = BriefingNews(id: 1, connection: 'TUportal', text: 'New hold on TUportal: a made-up hold');

Finder navigation(String label) => find.descendant(of: find.byType(NavigationBar), matching: find.text(label));

int selectedTab(WidgetTester tester) => tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex;

Future<void> openTab(WidgetTester tester, String label) async {
  await tester.tap(navigation(label));
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
  group('the latest Briefing on the Today tab', () {
    testWidgets('comes first, with its Milestones, Opportunities and news', (tester) async {
      await openUnlockedApp(
        tester,
        FakeBackend()
          ..latestBriefing = aBriefing(milestones: [standardMilestone()], opportunities: [fluClinic()], news: [hold])
          ..upcoming = [standardMilestone(id: 8, name: 'A date further off').milestone],
      );
      await openTab(tester, 'Today');

      expect(find.text('Your Briefing'), findsOneWidget);
      expect(find.text('From Tuesday, November 3 at 8:00 AM'), findsOneWidget);
      expect(find.text('Last day to withdraw'), findsOneWidget);
      expect(find.text('Source: Academic Calendar'), findsWidgets);
      expect(find.text('Flu Shot Clinic'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('New hold on TUportal: a made-up hold'), 200);
      expect(find.text('From TUportal'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Coming up'), 200);
      await tester.scrollUntilVisible(find.text('Your Briefing'), -200);
      expect(tester.getTopLeft(find.text('Your Briefing')).dy, lessThan(tester.getTopLeft(find.text('Last day to withdraw')).dy));
    });

    testWidgets('shows a Roadmap Milestone with its Goal, and why it has no Source', (tester) async {
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing(milestones: [goalMilestone()]));
      await openTab(tester, 'Today');

      expect(find.text('Ask for a recommendation'), findsOneWidget);
      expect(find.text('Goal: Get into PA school'), findsOneWidget);
      expect(find.text('You added this.'), findsOneWidget);
    });

    testWidgets('says how much else a Connection has than it shows', (tester) async {
      await openUnlockedApp(
        tester,
        FakeBackend()
          ..latestBriefing = aBriefing(news: [hold], moreNews: const [MoreBriefingNews(connection: 'TUmail', count: 2)]),
      );
      await openTab(tester, 'Today');

      await tester.scrollUntilVisible(find.text('And 2 others from TUmail.'), 200);
      expect(find.text('And 2 others from TUmail.'), findsOneWidget);
    });

    testWidgets('says when the first one comes, and shows nothing made up, before there has been one', (tester) async {
      await openUnlockedApp(tester, FakeBackend());
      await openTab(tester, 'Today');

      expect(find.text('Your first Briefing comes Wednesday, November 4 at 8:00 AM.'), findsOneWidget);
      expect(find.byType(Card), findsNothing);
    });

    testWidgets('says plainly that nothing needed the Student, and makes nothing up', (tester) async {
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing(milestones: [], hadNothing: true));
      await openTab(tester, 'Today');

      expect(find.text("Nothing needed you on Tuesday, November 3 at 8:00 AM, so Buddy sent no notification."), findsOneWidget);
      expect(find.byType(Card), findsNothing);
    });

    testWidgets('says so when what was in it has since gone', (tester) async {
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing(milestones: []));
      await openTab(tester, 'Today');

      expect(find.textContaining('has passed or been removed'), findsOneWidget);
    });

    testWidgets("says when it couldn't load, and tries again when asked", (tester) async {
      final backend = FakeBackend()..latestBriefingError = Exception('off');
      await openUnlockedApp(tester, backend);
      await openTab(tester, 'Today');
      expect(find.textContaining("couldn't load your Briefing"), findsOneWidget);

      backend
        ..latestBriefingError = null
        ..latestBriefing = aBriefing();
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Your Briefing'), findsOneWidget);
    });

    testWidgets('gets the newest each time the Student comes back to the tab', (tester) async {
      final backend = FakeBackend()..latestBriefing = aBriefing(milestones: [standardMilestone(name: 'Old')]);
      await openUnlockedApp(tester, backend);
      await openTab(tester, 'Today');
      expect(find.text('Old'), findsOneWidget);

      backend.latestBriefing = aBriefing(milestones: [standardMilestone(name: 'New')]);
      await openTab(tester, 'You');
      await openTab(tester, 'Today');

      expect(find.text('New'), findsOneWidget);
    });

    testWidgets('its heading and its news reach a screen reader as they should', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing(news: [hold], title: 'Your week ahead'));
      await openTab(tester, 'Today');

      expect(tester.getSemantics(find.text('Your week ahead')).flagsCollection.isHeader, isTrue);
      await tester.scrollUntilVisible(find.text('New hold on TUportal: a made-up hold'), 200);
      expect(find.bySemanticsLabel('From TUportal: New hold on TUportal: a made-up hold'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a Roadmap Milestone reads out as a Milestone, with its Goal', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing(milestones: [goalMilestone()]));
      await openTab(tester, 'Today');

      expect(
        find.bySemanticsLabel('Milestone: Ask for a recommendation. Wednesday, November 4, 2026. Goal: Get into PA school. You added this.'),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('fits on a small phone with large text', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openUnlockedApp(
        tester,
        FakeBackend()
          ..latestBriefing = aBriefing(
            title: 'Your week ahead',
            milestones: [standardMilestone(), goalMilestone()],
            opportunities: [fluClinic()],
            news: [hold],
            moreNews: const [MoreBriefingNews(connection: 'TUmail', count: 12)],
          ),
      );
      await openTab(tester, 'Today');

      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(find.text('And 12 others from TUmail.'), 200);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the messages fit on a small phone with large text', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing(milestones: [], hadNothing: true));
      await openTab(tester, 'Today');
      expect(tester.takeException(), isNull);
    });
  });

  group('tapping a Briefing notification', () {
    testWidgets('opens Today from another tab, with the newest Briefing', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend()..latestBriefing = aBriefing(milestones: [standardMilestone(name: 'Old')]);
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'You');

      backend.latestBriefing = aBriefing(milestones: [standardMilestone(name: 'New')]);
      phone.tapNotification();
      await tester.pumpAndSettle();

      expect(selectedTab(tester), 1);
      expect(find.text('New'), findsOneWidget);
    });

    testWidgets('opens Today from a cold start, once Buddy is unlocked', (tester) async {
      final lock = FakeAppLock([UnlockResult.failed]);
      await tester.pumpWidget(
        testApp(
          store: FakeDeviceStore(testDevice),
          lock: lock,
          access: FakeBackendAccess(FakeBackend()..latestBriefing = aBriefing()),
          phoneNotifications: FakePhoneNotifications(openedAtStart: true),
        ),
      );
      await settleApp(tester);
      expect(find.text('Your Briefing'), findsNothing);
      expect(find.byType(NavigationBar), findsNothing);

      await tester.tap(find.text('Unlock'));
      await tester.pumpAndSettle();

      expect(selectedTab(tester), 1);
      expect(find.text('Your Briefing'), findsOneWidget);
    });

    testWidgets("stays on the Buddy tab when the app wasn't opened by a notification", (tester) async {
      await openUnlockedApp(tester, FakeBackend()..latestBriefing = aBriefing());
      await tester.pumpAndSettle();

      expect(selectedTab(tester), 0);
    });

    testWidgets('waits behind the lock, and shows Today after it', (tester) async {
      final phone = FakePhoneNotifications();
      final lock = FakeAppLock();
      await tester.pumpWidget(
        testApp(
          store: FakeDeviceStore(testDevice),
          lock: lock,
          access: FakeBackendAccess(FakeBackend()..latestBriefing = aBriefing()),
          phoneNotifications: phone,
        ),
      );
      await tester.pumpAndSettle();
      await goToBackground(tester);

      phone.tapNotification();
      lock.answers.add(UnlockResult.failed);
      await comeBack(tester);
      await tester.pumpAndSettle();
      expect(find.text('Your Briefing').hitTestable(), findsNothing);

      await tester.tap(find.text('Unlock'));
      await tester.pumpAndSettle();

      expect(selectedTab(tester), 1);
      expect(find.text('Your Briefing').hitTestable(), findsOneWidget);
    });

    testWidgets('brings a Briefing back to the top when the Student had scrolled away', (tester) async {
      final phone = FakePhoneNotifications();
      await openUnlockedApp(
        tester,
        FakeBackend()
          ..latestBriefing = aBriefing()
          ..upcoming = [for (var id = 10; id < 20; id++) standardMilestone(id: id, name: 'Date $id').milestone],
        phoneNotifications: phone,
      );
      await openTab(tester, 'Today');
      await tester.scrollUntilVisible(find.text('Date 15'), 300);
      expect(find.text('Your Briefing').hitTestable(), findsNothing);

      phone.tapNotification();
      await tester.pumpAndSettle();

      expect(find.text('Your Briefing').hitTestable(), findsOneWidget);
    });
  });

  group('a Briefing arriving while Buddy is open', () {
    testWidgets('says so, and goes to Today when asked', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);

      backend.latestBriefing = aBriefing();
      phone.briefingArrives();
      await tester.pumpAndSettle();

      expect(find.text('Your Briefing is ready.'), findsOneWidget);
      expect(selectedTab(tester), 0);

      await tester.tap(find.text('See it'));
      await tester.pumpAndSettle();

      expect(selectedTab(tester), 1);
      expect(find.text('Your Briefing'), findsOneWidget);
    });

    testWidgets('just shows it when the Student is on Today', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'Today');

      backend.latestBriefing = aBriefing();
      phone.briefingArrives();
      await tester.pumpAndSettle();

      expect(find.text('See it'), findsNothing);
      expect(find.text('Your Briefing'), findsOneWidget);
    });
  });

  group('registering the phone', () {
    testWidgets('asks for permission after the unlock, then gives the backend its token', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await tester.pumpAndSettle();

      expect(phone.permissionAsks, 1);
      expect(backend.pushTokensSaved, ['made-up-push-token']);
    });

    testWidgets('asks the backend nothing while Buddy is still locked', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend();
      await tester.pumpWidget(
        testApp(
          store: FakeDeviceStore(testDevice),
          lock: FakeAppLock([UnlockResult.failed]),
          access: FakeBackendAccess(backend),
          phoneNotifications: phone,
        ),
      );
      await settleApp(tester);

      expect(phone.permissionAsks, 0);
      expect(backend.pushTokensSaved, isEmpty);
    });

    testWidgets('gives the backend a new token when Firebase changes it', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await tester.pumpAndSettle();

      phone.tokenChangesTo('a-newer-token');
      await tester.pumpAndSettle();

      expect(backend.pushTokensSaved, ['made-up-push-token', 'a-newer-token']);
    });

    testWidgets('tells the backend once when Firebase says the same token again', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await tester.pumpAndSettle();

      phone.tokenChangesTo('made-up-push-token');
      await openTab(tester, 'You');
      await tester.pumpAndSettle();

      expect(backend.pushTokensSaved, ['made-up-push-token']);
    });

    testWidgets('says so on the You tab when the Student has since turned them off in the phone settings', (tester) async {
      final phone = FakePhoneNotifications();
      await openUnlockedApp(tester, FakeBackend(), phoneNotifications: phone);
      await tester.pumpAndSettle();

      phone.allowed = false;
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining("You haven't allowed notifications"), 200);

      expect(find.textContaining("You haven't allowed notifications"), findsOneWidget);
    });

    testWidgets('gives no token when the Student says no', (tester) async {
      final phone = FakePhoneNotifications(allowed: false);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining("You haven't allowed notifications"), 200);

      expect(backend.pushTokensSaved, isEmpty);
      expect(find.textContaining("You haven't allowed notifications"), findsOneWidget);
    });

    testWidgets('asks again from the You tab, and registers once allowed', (tester) async {
      final phone = FakePhoneNotifications(allowed: false);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.text('Allow notifications'), 200);

      phone.allowed = true;
      await tester.ensureVisible(find.text('Allow notifications'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Allow notifications'));
      await tester.pumpAndSettle();

      expect(phone.permissionAsks, 2);
      expect(backend.pushTokensSaved, ['made-up-push-token']);
      expect(find.text('Allow notifications'), findsNothing);
    });

    testWidgets('says they are on when the backend has the token', (tester) async {
      await openUnlockedApp(tester, FakeBackend(), phoneNotifications: FakePhoneNotifications());
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining('Phone notifications are on'), 200);

      expect(find.textContaining('Phone notifications are on'), findsOneWidget);
    });

    testWidgets('notices when the Student allowed them in the phone settings', (tester) async {
      final phone = FakePhoneNotifications(allowed: false);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'You');

      phone.allowed = true;
      await openTab(tester, 'Today');
      await openTab(tester, 'You');
      await tester.pumpAndSettle();

      expect(phone.permissionAsks, 1);
      expect(backend.pushTokensSaved, ['made-up-push-token']);
    });

    testWidgets('says honestly that this build has no Firebase config, and asks for nothing', (tester) async {
      final phone = FakePhoneNotifications(setUpWorks: false);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining(notSetUp), 200);

      expect(find.textContaining(notSetUp), findsOneWidget);
      expect(phone.permissionAsks, 0);
      expect(backend.pushTokensSaved, isEmpty);
    });

    testWidgets("says when it couldn't reach the backend with the token, and tries again on the You tab", (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend()..pushTokenError = Exception('off');
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining("couldn't tell the backend"), 200);
      expect(find.textContaining("couldn't tell the backend"), findsOneWidget);

      backend.pushTokenError = null;
      await openTab(tester, 'Today');
      await openTab(tester, 'You');
      await tester.pumpAndSettle();

      expect(backend.pushTokensSaved, ['made-up-push-token']);
    });

    testWidgets("says when Firebase wouldn't give a token, as on an emulator without Google Play", (tester) async {
      final phone = FakePhoneNotifications(currentToken: null);
      await openUnlockedApp(tester, FakeBackend(), phoneNotifications: phone);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining("Firebase didn't give this phone"), 200);

      expect(find.textContaining("Firebase didn't give this phone"), findsOneWidget);
    });

    testWidgets("says the backend's reason when its side is off, whatever the phone says", (tester) async {
      final backend = FakeBackend()
        ..briefingSettings = const BriefingSettings(
          times: BriefingTimes(weekdays: '08:00', sunday: '18:00'),
          nextWhen: 'Wednesday, November 4 at 8:00 AM',
          phoneNotificationsOn: false,
          offBecause: "Phone notifications are off, because the backend wasn't given a file.",
        );
      await openUnlockedApp(tester, backend);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.textContaining("the backend wasn't given a file"), 200);

      expect(find.textContaining("the backend wasn't given a file"), findsOneWidget);
    });
  });

  group('Briefing times in the You tab', () {
    Future<void> openTimes(WidgetTester tester, FakeBackend backend) async {
      await openUnlockedApp(tester, backend);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.text('Weekdays at 8:00 AM'), 200);
      await tester.pumpAndSettle();
    }

    /// Picks from the dialog's three lists, then saves.
    Future<void> chooseTime(WidgetTester tester, String hour, String minute, String morningOrAfternoon) async {
      Future<void> pick(String label, String choice) async {
        await tester.tap(find.widgetWithText(InputDecorator, label));
        await tester.pumpAndSettle();
        await tester.tap(find.text(choice).last);
        await tester.pumpAndSettle();
      }

      await pick('Hour', hour);
      await pick('Minute', minute);
      await pick('Morning or afternoon', morningOrAfternoon);
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
    }

    testWidgets('shows both, and when the next Briefing is', (tester) async {
      await openTimes(tester, FakeBackend());

      expect(find.text('Weekdays at 8:00 AM'), findsOneWidget);
      expect(find.text('Sundays at 6:00 PM'), findsOneWidget);
      expect(find.textContaining('Philadelphia time'), findsOneWidget);
      expect(find.text('Your next Briefing is Wednesday, November 4 at 8:00 AM.'), findsOneWidget);
    });

    testWidgets('changes the weekday time, leaving Sunday as it was', (tester) async {
      final backend = FakeBackend();
      await openTimes(tester, backend);

      await tester.tap(find.text('Weekdays at 8:00 AM'));
      await tester.pumpAndSettle();
      await chooseTime(tester, '7', '05', 'AM');

      expect(backend.timesSaved.single.weekdays, '07:05');
      expect(backend.timesSaved.single.sunday, '18:00');
      expect(find.text('Weekdays at 7:05 AM'), findsOneWidget);
    });

    for (final (saved, words) in [('00:00', '12:00 AM'), ('12:00', '12:00 PM'), ('13:05', '1:05 PM'), ('23:59', '11:59 PM')]) {
      testWidgets('opens at $words and saves the same', (tester) async {
        final backend = FakeBackend()
          ..briefingSettings = BriefingSettings(
            times: BriefingTimes(weekdays: saved, sunday: '18:00'),
            nextWhen: 'Wednesday, November 4 at 8:00 AM',
            phoneNotificationsOn: true,
            offBecause: null,
          );
        await openUnlockedApp(tester, backend);
        await openTab(tester, 'You');
        await tester.scrollUntilVisible(find.text('Weekdays at $words'), 200);
        await tester.pumpAndSettle();

        await tester.tap(find.text('Weekdays at $words'));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Save'));
        await tester.pumpAndSettle();

        expect(backend.timesSaved.single.weekdays, saved);
      });
    }

    testWidgets('changes the Sunday time, leaving weekdays as they were', (tester) async {
      final backend = FakeBackend();
      await openTimes(tester, backend);

      await tester.tap(find.text('Sundays at 6:00 PM'));
      await tester.pumpAndSettle();
      await chooseTime(tester, '8', '05', 'PM');

      expect(backend.timesSaved.single.weekdays, '08:00');
      expect(backend.timesSaved.single.sunday, '20:05');
      expect(find.text('Sundays at 8:05 PM'), findsOneWidget);
    });

    testWidgets('saves nothing when the Student cancels', (tester) async {
      final backend = FakeBackend();
      await openTimes(tester, backend);

      await tester.tap(find.text('Weekdays at 8:00 AM'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(backend.timesSaved, isEmpty);
      expect(find.text('Weekdays at 8:00 AM'), findsOneWidget);
    });

    testWidgets('keeps showing what is saved when a change fails, and says so', (tester) async {
      final backend = FakeBackend()..saveTimesError = Exception('off');
      await openTimes(tester, backend);

      await tester.tap(find.text('Weekdays at 8:00 AM'));
      await tester.pumpAndSettle();
      await chooseTime(tester, '7', '05', 'AM');

      expect(find.text('Weekdays at 8:00 AM'), findsOneWidget);
      expect(find.textContaining("so nothing changed"), findsOneWidget);
    });

    testWidgets("says when it can't load them, and tries again", (tester) async {
      final backend = FakeBackend()..briefingSettingsError = Exception('off');
      await openUnlockedApp(tester, backend);
      await openTab(tester, 'You');
      await tester.scrollUntilVisible(find.text('Try again'), 200);

      backend.briefingSettingsError = null;
      await tester.ensureVisible(find.text('Try again'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Try again'));
      await tester.pumpAndSettle();

      expect(find.text('Weekdays at 8:00 AM'), findsOneWidget);
    });

    testWidgets('says what each button does to a screen reader, with a heading', (tester) async {
      final handle = tester.ensureSemantics();
      await openTimes(tester, FakeBackend());

      expect(tester.getSemantics(find.text('Briefings')).flagsCollection.isHeader, isTrue);
      final button = find.bySemanticsLabel('Weekday Briefings go at 8:00 AM. Change the time');
      expect(button, findsOneWidget);
      expect(tester.getSemantics(button).flagsCollection.isButton, isTrue);
      expect(find.bySemanticsLabel('Sunday week-ahead Briefings go at 6:00 PM. Change the time'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('fits on a small phone with large text, the picker too', (tester) async {
      useSmallPhoneWithLargeText(tester);
      await openTimes(tester, FakeBackend());
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('Weekdays at 8:00 AM'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('the app talking to the backend about Briefings', () {
    final baseUrl = Uri.parse('http://backend.test');

    HttpBuddyBackend backendAnswering(Future<http.Response> Function(http.Request) answer, {void Function()? onKeyRefused}) => HttpBuddyBackend(
          baseUrl,
          deviceKey: 'the-key',
          onKeyRefused: onKeyRefused ?? () {},
          client: MockClient(answer),
        );

    test('reads the latest Briefing', () async {
      final backend = backendAnswering((request) async {
        expect(request.url.path, '/briefings/latest');
        expect(request.headers['authorization'], 'Bearer the-key');
        return http.Response(
          jsonEncode({
            'briefing': {
              'id': 4,
              'kind': 'week_ahead',
              'title': 'Your week ahead',
              'madeAt': '2026-11-08T23:00:00.000Z',
              'when': 'Sunday, November 8 at 6:00 PM',
              'milestones': [
                {
                  'id': 7,
                  'key': 'roadmap 7',
                  'name': 'Ask for a recommendation',
                  'term': null,
                  'when': 'Wednesday, November 11, 2026',
                  'passed': false,
                  'sources': [],
                  'sourceNote': 'You added this.',
                  'goal': 'Get into PA school',
                },
              ],
              'opportunities': [
                {
                  'id': 3,
                  'name': 'Flu Shot Clinic',
                  'summary': 'A free flu shot.',
                  'when': 'Tuesday, November 10, 2026',
                  'date': '2026-11-10',
                  'endDate': null,
                  'cost': 'Free',
                  'worthItBecause': null,
                  'outsideTemple': false,
                  'place': null,
                  'forGoals': [],
                  'saved': false,
                  'sources': [],
                },
              ],
              'news': [
                {'id': 9, 'connection': 'TUportal', 'text': 'New hold', 'at': '2026-11-08T20:00:00.000Z'},
              ],
              'moreNews': [
                {'connection': 'TUmail', 'count': 2},
              ],
              'hadNothing': false,
            },
          }),
          200,
        );
      });

      final briefing = (await backend.loadLatestBriefing())!;

      expect(briefing.title, 'Your week ahead');
      expect(briefing.when, 'Sunday, November 8 at 6:00 PM');
      expect(briefing.milestones.single.milestone.name, 'Ask for a recommendation');
      expect(briefing.milestones.single.goal, 'Get into PA school');
      expect(briefing.milestones.single.sourceNote, 'You added this.');
      expect(briefing.opportunities.single.name, 'Flu Shot Clinic');
      expect(briefing.news.single.connection, 'TUportal');
      expect(briefing.moreNews.single.count, 2);
      expect(briefing.hadNothing, isFalse);
    });

    test('reads that there has been no Briefing yet', () async {
      final backend = backendAnswering((request) async => http.Response(jsonEncode({'briefing': null}), 200));

      expect(await backend.loadLatestBriefing(), isNull);
    });

    test('reads the settings', () async {
      final backend = backendAnswering((request) async {
        expect(request.url.path, '/briefings/settings');
        return http.Response(
          jsonEncode({
            'times': {'weekdays': '08:00', 'sunday': '18:00'},
            'next': {'kind': 'weekday', 'at': '2026-11-03T13:00:00.000Z', 'when': 'Tuesday, November 3 at 8:00 AM'},
            'phoneNotifications': {'on': false, 'offBecause': 'Phone notifications are off.'},
          }),
          200,
        );
      });

      final settings = await backend.loadBriefingSettings();

      expect(settings.times.weekdays, '08:00');
      expect(settings.times.sunday, '18:00');
      expect(settings.nextWhen, 'Tuesday, November 3 at 8:00 AM');
      expect(settings.phoneNotificationsOn, isFalse);
      expect(settings.offBecause, 'Phone notifications are off.');
    });

    test('saves new times', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'PUT');
        expect(request.url.path, '/briefings/settings');
        expect(jsonDecode(request.body), {'weekdays': '07:15', 'sunday': '20:45'});
        return http.Response(
          jsonEncode({
            'times': {'weekdays': '07:15', 'sunday': '20:45'},
            'next': {'kind': 'weekday', 'at': '2026-11-03T12:15:00.000Z', 'when': 'Tuesday, November 3 at 7:15 AM'},
            'phoneNotifications': {'on': true, 'offBecause': null},
          }),
          200,
        );
      });

      final settings = await backend.saveBriefingTimes(const BriefingTimes(weekdays: '07:15', sunday: '20:45'));

      expect(settings.times.weekdays, '07:15');
      expect(settings.phoneNotificationsOn, isTrue);
    });

    test('gives the backend the push token, in the body and not the address', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'PUT');
        expect(request.url.toString(), 'http://backend.test/devices/push-token');
        expect(jsonDecode(request.body), {'token': 'made-up-push-token'});
        return http.Response('', 204);
      });

      await backend.savePushToken('made-up-push-token');
    });

    test('notices when the backend refuses the key', () async {
      var refused = false;
      final backend = backendAnswering((request) async => http.Response('', 401), onKeyRefused: () => refused = true);

      await expectLater(backend.savePushToken('made-up-push-token'), throwsA(isA<BackendException>()));

      expect(refused, isTrue);
    });
  });
}
