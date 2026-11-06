import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/briefings/briefing_backend.dart';
import 'package:buddy/roadmap/roadmap_backend.dart';
import 'package:buddy/sending/sending_backend.dart';
import 'package:buddy/spending/spending_backend.dart';
import 'package:buddy/widgets/buddy_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

int selectedTab(WidgetTester tester) => tester.widget<BuddyNavBar>(find.byType(BuddyNavBar)).selected;

const today = 0;
const buddyTab = 1;
const roadmapTab = 2;
const youTab = 3;

Connection aConnection(String id, String name, {bool on = false, bool needsLogin = false}) => Connection(
      id: id,
      name: name,
      on: on,
      needsLogin: needsLogin,
      logsIn: true,
      card: const ReadPermissionCardContent(reads: ['Your records.'], notes: []),
    );

const aGoal = Goal(id: 1, text: 'Find an internship');

RoadmapMilestone aMilestone({bool done = false}) => RoadmapMilestone(
      id: 1,
      done: done,
      goal: aGoal,
      name: 'Update my resume',
      when: 'November 20, 2026',
      sources: const [],
      sourceNote: 'You added this.',
      calendarUrl: 'https://calendar.google.com/calendar/render',
    );

void useOrdinaryPhone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  group('where the app opens', () {
    testWidgets('on Today for a Student who has already written to Buddy', (tester) async {
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('Hi')]), leftToItself: true);

      expect(selectedTab(tester), today);
      expect(find.textContaining('Philadelphia time'), findsOneWidget);
    });

    testWidgets('on the conversation for a Student who has not, so that Buddy introduces itself', (tester) async {
      await openUnlockedApp(tester, FakeBackend(history: [buddy('I am Buddy.')]), leftToItself: true);

      expect(selectedTab(tester), buddyTab);
      expect(find.text('I am Buddy.'), findsOneWidget);
    });

    testWidgets('stays on Today if the conversation cannot be loaded', (tester) async {
      await openUnlockedApp(tester, FakeBackend()..historyError = Exception('no backend'), leftToItself: true);

      expect(selectedTab(tester), today);
    });

    testWidgets('does not pull a Student away from a tab they already chose', (tester) async {
      final backend = FakeBackend(history: [buddy('I am Buddy.')]);
      await tester.pumpWidget(testApp(store: FakeDeviceStore(testDevice), lock: FakeAppLock(), access: FakeBackendAccess(backend)));
      // Only as far as the tabs being there, before the conversation has answered.
      for (var frame = 0; frame < 2 && find.byType(BuddyNavBar).evaluate().isEmpty; frame++) {
        await tester.pump();
      }
      if (find.byType(BuddyNavBar).evaluate().isNotEmpty && selectedTab(tester) == today) {
        await goToTab(tester, 'Roadmap');
        await settleApp(tester);
        expect(selectedTab(tester), roadmapTab);
      }
    });

    testWidgets('the tabs run Today, Buddy, Roadmap, You, each named in its tooltip', (tester) async {
      await openUnlockedApp(tester, FakeBackend());

      final names = tester
          .widgetList<Tooltip>(find.descendant(of: find.byType(BuddyNavBar), matching: find.byType(Tooltip)))
          .map((tooltip) => tooltip.message)
          .toList();
      expect(names, ['Today', 'Buddy', 'Roadmap', 'You']);
    });

    testWidgets('the bar shows icons only, so large text has nothing in it to squeeze', (tester) async {
      await openUnlockedApp(tester, FakeBackend());

      expect(find.descendant(of: find.byType(BuddyNavBar), matching: find.byType(Text)), findsNothing);
      expect(find.descendant(of: find.byType(BuddyNavBar), matching: find.byType(Icon)), findsNWidgets(4));
    });

    testWidgets('a long press on a tab shows its name', (tester) async {
      await openUnlockedApp(tester, FakeBackend());

      await tester.longPress(tabButton('Roadmap'));
      await tester.pump(const Duration(milliseconds: 500));

      expect(find.text('Roadmap'), findsOneWidget);
    });

    testWidgets('a screen reader hears which tab is which and which one is selected', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend());

      expect(tester.getSemantics(find.bySemanticsLabel('Buddy, tab 2 of 4')), isSemantics(isSelected: true, isButton: true, hasTapAction: true));
      expect(tester.getSemantics(find.bySemanticsLabel('You, tab 4 of 4')), isSemantics(isSelected: false, isButton: true, hasTapAction: true));
      handle.dispose();
    });
  });

  group('the You tab', () {
    testWidgets('groups its rows, and leads to each part of the Student\'s controls', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend());
      await goToTab(tester, 'You');
      await settleApp(tester);

      for (final words in ['ABOUT YOU', 'WHAT BUDDY CAN DO', 'HISTORY AND CONTROLS', 'Your Goals', 'Profile', 'Connections', 'Nudges', 'Email Buddy sends', 'Activity', 'What Buddy spent']) {
        expect(find.text(words), findsOneWidget, reason: words);
      }
    });

    testWidgets('says how each part stands without opening it', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..goals = [aGoal, const Goal(id: 2, text: 'Plan my semester')]
        ..connections = [aConnection('canvas', 'Canvas', on: true), aConnection('dars', 'DARS')]
        ..sending = const SendingSettings(isLive: false, ownAddress: null)
        ..spendingSummary = const SpendingSummary(todayNanodollars: 420000000, thisMonthNanodollars: 0, backgroundLimitNanodollars: 2000000000, backgroundStoppedForToday: false);
      await openUnlockedApp(tester, backend);
      await goToTab(tester, 'You');
      await settleApp(tester);

      expect(find.text('2 Goals'), findsOneWidget);
      expect(find.text('1 of 2 on'), findsOneWidget);
      expect(find.text('Practice mode'), findsOneWidget);
      expect(find.text('Next Briefing Wednesday, November 4 at 8:00 AM'), findsOneWidget);
      expect(find.text('Today: \$0.42'), findsOneWidget);
    });

    testWidgets('warns on the row when a Connection needs a login', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend()..connections = [aConnection('canvas', 'Canvas', on: true, needsLogin: true)]);
      await goToTab(tester, 'You');
      await settleApp(tester);

      expect(find.text('Canvas needs login'), findsOneWidget);
      expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
    });

    testWidgets('makes Live stand out from Practice mode', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend()..sending = const SendingSettings(isLive: true, ownAddress: null));
      await goToTab(tester, 'You');
      await settleApp(tester);

      expect(find.text('Live'), findsOneWidget);
      expect(find.text('Practice mode'), findsNothing);
    });

    testWidgets('a row is one stop for a screen reader, and says what it shows', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend()..sending = const SendingSettings(isLive: false, ownAddress: null));
      await goToTab(tester, 'You');
      await settleApp(tester);

      expect(find.bySemanticsLabel('Email Buddy sends. Practice mode is on'), findsOneWidget);
      expect(find.bySemanticsLabel('Practice mode'), findsNothing);
      expect(tester.getSemantics(find.bySemanticsLabel('Email Buddy sends. Practice mode is on')), isSemantics(isButton: true, hasTapAction: true));
      handle.dispose();
    });

    testWidgets('keeps the prototype note', (tester) async {
      await openUnlockedApp(tester, FakeBackend());
      await goToTab(tester, 'You');
      await settleApp(tester);
      await tester.dragUntilVisible(find.text('Hackathon prototype, not an official Temple University service'), find.byType(ListView).last, const Offset(0, -200));

      expect(find.text('Hackathon prototype, not an official Temple University service'), findsOneWidget);
    });

    testWidgets('meets the tap target, label and contrast guidelines', (tester) async {
      useOrdinaryPhone(tester);
      final handle = tester.ensureSemantics();
      await openUnlockedApp(tester, FakeBackend());
      await goToTab(tester, 'You');
      await settleApp(tester);

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 568)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      await openUnlockedApp(tester, FakeBackend());
      await goToTab(tester, 'You');
      await settleApp(tester);

      expect(tester.takeException(), isNull);
    });
  });

  group('several Connections needing a login', () {
    Future<FakeBackend> openToday(WidgetTester tester, List<Connection> connections) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend(history: [student('Hello')])..connections = connections;
      await openUnlockedApp(tester, backend, leftToItself: true);
      await goToTab(tester, 'Today');
      await settleApp(tester);
      return backend;
    }

    testWidgets('share one notice, naming each, with a way to log in to each', (tester) async {
      await openToday(tester, [
        aConnection('tuportal', 'TUportal', on: true, needsLogin: true),
        aConnection('dars', 'DARS', on: true, needsLogin: true),
        aConnection('navigate360', 'Navigate360', on: true, needsLogin: true),
      ]);

      expect(find.text('3 Connections need you to log in'), findsOneWidget);
      expect(find.textContaining("Buddy can't read TUportal, DARS and Navigate360 until you do."), findsOneWidget);
      expect(find.text('Log in to TUportal'), findsOneWidget);
      expect(find.text('Log in to DARS'), findsOneWidget);
      expect(find.text('Log in to Navigate360'), findsOneWidget);
    });

    testWidgets('one by itself keeps its own words', (tester) async {
      await openToday(tester, [aConnection('dars', 'DARS', on: true, needsLogin: true)]);

      expect(find.text('DARS needs you to log in'), findsOneWidget);
      expect(find.textContaining('Connections need you to log in'), findsNothing);
    });

    testWidgets('a login that could not start says so right there', (tester) async {
      final backend = await openToday(tester, [aConnection('dars', 'DARS', on: true, needsLogin: true)]);
      backend.startTakeoverError = Exception('no browser');

      await tester.tap(find.text('Log in to DARS'));
      await settleApp(tester);

      expect(find.textContaining("Buddy couldn't open its browser"), findsOneWidget);
    });

    testWidgets('a row says it once, without the problem repeating it', (tester) async {
      useOrdinaryPhone(tester);
      final connection = Connection(
        id: 'dars',
        name: 'DARS',
        on: true,
        needsLogin: true,
        logsIn: true,
        lastReadProblem: 'Buddy needs you to log in to DARS before it can read it. Tap Log in to DARS on the You tab.',
        card: const ReadPermissionCardContent(reads: [], notes: []),
      );
      await openUnlockedApp(tester, FakeBackend()..connections = [connection]);
      await openYouRow(tester, 'Connections');

      expect(find.text('Needs you to log in'), findsOneWidget);
      expect(find.textContaining('before it can read it. Tap Log in'), findsNothing);
    });
  });

  group('asking for a Read Permission', () {
    Connection canvas({bool on = false, bool needsLogin = false, String? why}) => Connection(
          id: 'canvas',
          name: 'Canvas',
          on: on,
          needsLogin: needsLogin,
          logsIn: true,
          card: ReadPermissionCardContent(why: why, reads: const ['Your courses.'], notes: const ['Buddy never submits anything.'], warning: "Canvas's own rules forbid this."),
        );

    Future<void> openCanvas(WidgetTester tester, FakeBackend backend) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, backend);
      await openYouRow(tester, 'Connections');
      await tester.tap(find.text('Canvas'));
      await settleRoute(tester);
    }

    testWidgets('says what the Student gets from saying yes, when there is something to say', (tester) async {
      await openCanvas(tester, FakeBackend()..connections = [canvas(why: "So Buddy can tell you what's due.")]);

      expect(find.text("So Buddy can tell you what's due."), findsOneWidget);
    });

    testWidgets('does without it when there is nothing to say', (tester) async {
      await openCanvas(tester, FakeBackend()..connections = [canvas()]);

      expect(find.text('Let Buddy read Canvas?'), findsOneWidget);
    });

    testWidgets('puts the warning above the button, where it cannot be missed on the way', (tester) async {
      tester.view.physicalSize = const Size(412, 2000);
      addTearDown(tester.view.reset);
      await openCanvas(tester, FakeBackend()..connections = [canvas()]);

      expect(tester.getTopLeft(find.textContaining('Warning: ')).dy, lessThan(tester.getTopLeft(find.text('Good to know')).dy));
      expect(tester.getTopLeft(find.text('Good to know')).dy, lessThan(tester.getTopLeft(find.text('Give Read Permission')).dy));
    });

    testWidgets('Not now goes back and gives nothing', (tester) async {
      final backend = FakeBackend()..connections = [canvas()];
      await openCanvas(tester, backend);

      await tester.ensureVisible(find.text('Not now'));
      await tester.pump();
      await tester.tap(find.text('Not now'));
      await settleRoute(tester);

      expect(backend.gave, isEmpty);
      expect(find.text('Let Buddy read Canvas?'), findsNothing);
    });

    testWidgets('catches up if it went through but the answer never arrived', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvas()]
        ..giveError = Exception('the answer was lost');
      await openCanvas(tester, backend);

      // What the backend will say next time it's asked, because the tap did get there.
      backend.connections = [canvas(on: true)];
      await tester.ensureVisible(find.text('Give Read Permission'));
      await tester.pump();
      await tester.tap(find.text('Give Read Permission'));
      await settleRoute(tester);

      expect(find.text('Let Buddy read Canvas?'), findsNothing);
      expect(find.text('Canvas is connected'), findsOneWidget);
      expect(find.text('Give Read Permission'), findsNothing);
    });

    testWidgets('goes on to the login if that is what it turns out to need', (tester) async {
      final backend = FakeBackend()
        ..connections = [canvas()]
        ..giveError = Exception('the answer was lost');
      await openCanvas(tester, backend);

      backend.connections = [canvas(on: true, needsLogin: true)];
      await tester.ensureVisible(find.text('Give Read Permission'));
      await tester.pump();
      await tester.tap(find.text('Give Read Permission'));
      await settleRoute(tester);

      expect(find.text('Log in to Canvas'), findsOneWidget);
    });
  });

  group('help in a crisis, away from the conversation', () {
    Future<List<Uri>> openHelp(WidgetTester tester) async {
      useOrdinaryPhone(tester);
      final opened = <Uri>[];
      await openUnlockedApp(tester, FakeBackend(), openPhone: (address) async {
        opened.add(address);
        return true;
      });
      await openYouRow(tester, 'Need help right now?');
      return opened;
    }

    testWidgets('is one row away on the You tab, whatever has been said', (tester) async {
      await openHelp(tester);

      expect(find.text('Help is here, right now'), findsOneWidget);
    });

    testWidgets('lists the same Resources as the Crisis card, in the same order', (tester) async {
      await openHelp(tester);

      final names = [
        '988 Suicide & Crisis Lifeline',
        'Crisis Text Line',
        'Emergency services',
        'Tuttleman Counseling at Temple',
      ];
      final tops = [for (final name in names) tester.getTopLeft(find.text(name)).dy];
      expect(tops, [...tops]..sort());
      for (final words in ['Call 988', 'Text 988', 'Text HOME to 741741', 'Call 911', 'Call (215) 204-7276']) {
        expect(find.text(words), findsOneWidget, reason: words);
      }
    });

    testWidgets('each button opens the phone itself', (tester) async {
      final opened = await openHelp(tester);

      await tester.tap(find.text('Call 988'));
      await tester.pump();

      expect(opened, [Uri.parse('tel:988')]);
    });

    testWidgets('needs nothing from the backend', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend()
        ..historyError = Exception('no backend')
        ..connectionsError = Exception('no backend');
      await openUnlockedApp(tester, backend);
      await openYouRow(tester, 'Need help right now?');

      expect(find.text('Call 988'), findsOneWidget);
    });
  });

  group('getting started, on Today', () {
    Future<void> openToday(WidgetTester tester, FakeBackend backend) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, backend, leftToItself: true);
      await goToTab(tester, 'Today');
      await settleApp(tester);
    }

    testWidgets('offers what has not been done yet', (tester) async {
      await openToday(tester, FakeBackend(history: [student('Hello')])..connections = [aConnection('canvas', 'Canvas')]);

      expect(find.text('Get started'), findsOneWidget);
      expect(find.text('Choose a Goal'), findsOneWidget);
      expect(find.text('Connect a Temple system'), findsOneWidget);
      expect(find.text('Build your Roadmap'), findsNothing);
    });

    testWidgets('moves on to the Roadmap once there is a Goal', (tester) async {
      await openToday(tester, FakeBackend(history: [student('Hello')])..goals = [aGoal]);

      expect(find.text('Choose a Goal'), findsNothing);
      expect(find.text('Build your Roadmap'), findsOneWidget);
    });

    testWidgets('goes away once everything is done', (tester) async {
      await openToday(
        tester,
        FakeBackend(history: [student('Hello')])
          ..goals = [aGoal]
          ..milestones = [aMilestone()]
          ..connections = [aConnection('canvas', 'Canvas', on: true)],
      );

      expect(find.text('Get started'), findsNothing);
    });

    testWidgets('choosing a Goal asks Buddy for help with it', (tester) async {
      final backend = FakeBackend(history: [student('Hello')]);
      await openToday(tester, backend);

      await tester.ensureVisible(find.text('Choose a Goal'));
      await tester.pump();
      await tester.tap(find.text('Choose a Goal'));
      await settleApp(tester);

      expect(backend.sent, ['Help me choose a Goal.']);
      expect(selectedTab(tester), buddyTab);
    });

    testWidgets('connecting opens the list of Connections', (tester) async {
      await openToday(tester, FakeBackend(history: [student('Hello')])..connections = [aConnection('canvas', 'Canvas')]);

      await tester.ensureVisible(find.text('Connect a Temple system'));
      await tester.pump();
      await tester.tap(find.text('Connect a Temple system'));
      await tester.pumpAndSettle();

      expect(find.text('Canvas'), findsOneWidget);
    });

    testWidgets('building a Roadmap goes to its tab', (tester) async {
      await openToday(tester, FakeBackend(history: [student('Hello')])..goals = [aGoal]);

      await tester.ensureVisible(find.text('Build your Roadmap'));
      await tester.pump();
      await tester.tap(find.text('Build your Roadmap'));
      await settleApp(tester);

      expect(selectedTab(tester), roadmapTab);
    });
  });

  group('the Briefing on Today', () {
    Briefing aBriefing() => Briefing(
          title: 'Your Briefing',
          when: 'Wednesday, November 4 at 8:00 AM',
          milestones: const [
            BriefingMilestone(
              key: 'roadmap 1',
              milestone: StandardMilestone(id: 1, name: 'Update my resume', when: 'November 6, 2026', passed: false, sources: []),
              goal: 'Find an internship',
              sourceNote: 'You added this.',
            ),
            BriefingMilestone(
              key: 'standard 2',
              milestone: StandardMilestone(id: 2, name: 'Last day to withdraw', when: 'November 9, 2026', passed: false, sources: []),
            ),
          ],
          opportunities: const [],
          news: const [],
          moreNews: const [],
          hadNothing: false,
        );

    Future<void> openBriefing(WidgetTester tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello')])..latestBriefing = aBriefing(), leftToItself: true);
      await goToTab(tester, 'Today');
      await settleApp(tester);
    }

    testWidgets('says what kind of Milestone each one is', (tester) async {
      await openBriefing(tester);

      expect(find.text('YOUR ROADMAP'), findsOneWidget);
      expect(find.text('STANDARD MILESTONE'), findsOneWidget);
    });

    testWidgets('leads from a Roadmap Milestone to the Roadmap, and only from one of those', (tester) async {
      await openBriefing(tester);

      expect(find.text('View Roadmap'), findsOneWidget);

      await tester.tap(find.text('View Roadmap'));
      await settleApp(tester);

      expect(selectedTab(tester), roadmapTab);
    });
  });

  group('pulling Today down', () {
    testWidgets('reads everything on it again', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend(history: [student('Hello')]);
      await openUnlockedApp(tester, backend, leftToItself: true);
      await goToTab(tester, 'Today');
      await settleApp(tester);
      final loadsBefore = backend.latestBriefingLoads;
      final tasksBefore = backend.taskLoads;
      final opportunitiesBefore = backend.opportunityLoads;
      expect(find.text('Last day to withdraw'), findsNothing);

      backend.upcoming = [const StandardMilestone(id: 1, name: 'Last day to withdraw', when: 'November 9, 2026', passed: false, sources: [])];
      await tester.fling(find.byType(ListView).first, const Offset(0, 400), 1000);
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 1));

      expect(backend.latestBriefingLoads, greaterThan(loadsBefore));
      expect(backend.taskLoads, greaterThan(tasksBefore));
      expect(backend.opportunityLoads, greaterThan(opportunitiesBefore));
      // The dates are last on Today, below the welcome at the top.
      await tester.scrollUntilVisible(find.text('Last day to withdraw'), 200, scrollable: find.byType(Scrollable).first);
      expect(find.text('Last day to withdraw'), findsOneWidget);
    });
  });

  group('Activity', () {
    final now = DateTime.now();
    final yesterday = DateUtils.addDaysToDate(now, -1);

    List<ActivityEntry> someEntries() => [
          ActivityEntry(kind: 'connection_read', title: 'Buddy read Canvas', at: now),
          ActivityEntry(kind: 'read_permission_given', title: 'You gave Buddy a Read Permission for Canvas', at: now),
          ActivityEntry(kind: 'email_sent', title: 'Buddy sent an email from your TUmail', at: yesterday),
          ActivityEntry(kind: 'guidebook_report', title: 'You reported the Writing Center', at: yesterday),
          ActivityEntry(
            kind: 'reply',
            title: 'Buddy replied',
            at: yesterday,
            decision: const ReplyDecision(reply: 'Here is what I found.', tools: [], sources: [], facts: []),
          ),
        ];

    Future<void> openActivity(WidgetTester tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend()..activity = someEntries());
      await openYouRow(tester, 'Activity');
    }

    testWidgets('puts each entry under its day', (tester) async {
      await openActivity(tester);

      expect(find.text('TODAY'), findsOneWidget);
      expect(find.text('YESTERDAY'), findsOneWidget);
      expect(tester.getTopLeft(find.text('TODAY')).dy, lessThan(tester.getTopLeft(find.text('Buddy read Canvas')).dy));
      expect(tester.getTopLeft(find.text('Buddy read Canvas')).dy, lessThan(tester.getTopLeft(find.text('YESTERDAY')).dy));
      expect(tester.getTopLeft(find.text('YESTERDAY')).dy, lessThan(tester.getTopLeft(find.text('Buddy sent an email from your TUmail')).dy));
    });

    testWidgets('starts with everything, including kinds no filter covers', (tester) async {
      await openActivity(tester);

      expect(find.text('You reported the Writing Center'), findsOneWidget);
    });

    testWidgets('narrows to one kind of thing, and back', (tester) async {
      await openActivity(tester);

      await tester.tap(find.text('What Buddy read'));
      await tester.pump();
      expect(find.text('Buddy read Canvas'), findsOneWidget);
      expect(find.text('Buddy replied'), findsNothing);

      await tester.tap(find.text('Permissions'));
      await tester.pump();
      expect(find.text('You gave Buddy a Read Permission for Canvas'), findsOneWidget);
      expect(find.text('Buddy read Canvas'), findsNothing);

      await tester.tap(find.text('Emails'));
      await tester.pump();
      expect(find.text('Buddy sent an email from your TUmail'), findsOneWidget);
      expect(find.text('You gave Buddy a Read Permission for Canvas'), findsNothing);

      await tester.tap(find.text('Replies'));
      await tester.pump();
      expect(find.text('Buddy replied'), findsOneWidget);
      expect(find.text('How Buddy decided'), findsOneWidget);
      expect(find.text('Buddy sent an email from your TUmail'), findsNothing);

      await tester.tap(find.text('Everything'));
      await tester.pump();
      expect(find.text('You reported the Writing Center'), findsOneWidget);
    });

    testWidgets('says so when a kind has nothing to show', (tester) async {
      useOrdinaryPhone(tester);
      await openUnlockedApp(tester, FakeBackend()..activity = [ActivityEntry(kind: 'reply', title: 'Buddy replied', at: now)]);
      await openYouRow(tester, 'Activity');

      await tester.tap(find.text('Emails'));
      await tester.pump();

      expect(find.text('Nothing of this kind yet.'), findsOneWidget);
    });
  });

  group('a new Crisis card', () {
    testWidgets('comes to the front from any screen, not just from another tab', (tester) async {
      useOrdinaryPhone(tester);
      final backend = FakeBackend(history: [student('Hello'), buddy('Hi')]);
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'One more thing');

      await openYouRow(tester, 'Profile');
      expect(find.text('What Buddy knows about you'), findsOneWidget);

      backend.reply.add(const ReplyCrisisCard());
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      expect(selectedTab(tester), buddyTab);
      expect(find.text('What Buddy knows about you'), findsNothing);
      expect(find.text('Help is here, right now'), findsOneWidget);
    });
  });

  group('the conversation', () {
    testWidgets('offers places to begin until the Student has written something', (tester) async {
      await openUnlockedApp(tester, FakeBackend(history: [buddy('I am Buddy.')]));

      expect(find.text('Understand a hold'), findsOneWidget);
      expect(find.text('Plan my next week'), findsOneWidget);
      expect(find.text('Find someone to talk to'), findsOneWidget);
    });

    testWidgets('a place to begin goes into the conversation like anything typed', (tester) async {
      final backend = FakeBackend(history: [buddy('I am Buddy.')]);
      await openUnlockedApp(tester, backend);

      await tester.tap(find.text('Plan my next week'));
      await tester.pump();

      expect(backend.sent, ['Help me plan my next week.']);
      expect(find.text('Help me plan my next week.'), findsOneWidget);
    });

    testWidgets('then keeps them as small shortcuts, out of the way of writing', (tester) async {
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('Hi')]));

      expect(find.byType(ActionChip), findsNWidgets(3));

      await tester.showKeyboard(find.byType(TextField));
      await tester.pump();

      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets('leaves them out while Buddy is replying', (tester) async {
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('Hi')]));

      await sendMessage(tester, 'One more thing');

      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets('leaves them out soon after a Crisis card', (tester) async {
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), CrisisCardItem(), buddy('I am here.')]));

      expect(find.text('Call 988'), findsOneWidget);
      expect(find.byType(ActionChip), findsNothing);
    });

    testWidgets('leaves them out with large text, where the conversation needs the room', (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearAllTestValues);
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('Hi')]));

      expect(find.byType(ActionChip), findsNothing);
    });

    group('puts Buddy\'s words above the cards they introduce', () {
      final card = GuidebookItem(id: 1, name: 'Writing Center', summary: 'Help with writing.', cost: 'Free', sources: const []);

      testWidgets('in a reply that has already finished', (tester) async {
        useOrdinaryPhone(tester);
        await openUnlockedApp(tester, FakeBackend(history: [student('Where can I get help?'), GuidebookCardItem(card), buddy('The Writing Center can help.')]));

        final words = tester.getTopLeft(find.text('The Writing Center can help.')).dy;
        expect(words, greaterThan(tester.getTopLeft(find.text('Where can I get help?')).dy));
        expect(words, lessThan(tester.getTopLeft(find.text('Writing Center')).dy));
      });

      testWidgets('while the reply is still arriving, so that nothing jumps when it ends', (tester) async {
        useOrdinaryPhone(tester);
        final backend = FakeBackend(history: [student('Hello'), buddy('Hi')]);
        await openUnlockedApp(tester, backend);
        await sendMessage(tester, 'Where can I get help?');

        backend.reply
          ..add(ReplyGuidebookCard(card))
          ..add(const ReplyText('The Writing Center'));
        await tester.pump();
        await tester.pump();

        final wordsWhileArriving = tester.getTopLeft(find.text('The Writing Center')).dy;
        expect(wordsWhileArriving, lessThan(tester.getTopLeft(find.text('Writing Center')).dy));

        backend.reply.add(ReplyDone(buddy('The Writing Center')));
        await backend.reply.close();
        await tester.pump();
        await tester.pump();

        expect(tester.getTopLeft(find.text('The Writing Center')).dy, lessThan(tester.getTopLeft(find.text('Writing Center')).dy));
      });

      testWidgets('but never above a Crisis card, which comes before anything else', (tester) async {
        useOrdinaryPhone(tester);
        await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), CrisisCardItem(), buddy('I am here with you.')]));

        expect(tester.getTopLeft(find.text('Help is here, right now')).dy, lessThan(tester.getTopLeft(find.text('I am here with you.')).dy));
      });

      testWidgets('and a card from an earlier turn stays in that turn', (tester) async {
        useOrdinaryPhone(tester);
        await openUnlockedApp(tester, FakeBackend(history: [student('First'), GuidebookCardItem(card), buddy('First answer'), student('Second'), buddy('Second answer')]));

        expect(tester.getTopLeft(find.text('Writing Center')).dy, lessThan(tester.getTopLeft(find.text('Second')).dy));
        expect(tester.getTopLeft(find.text('First answer')).dy, lessThan(tester.getTopLeft(find.text('Writing Center')).dy));
      });
    });

    testWidgets('marks where each day begins', (tester) async {
      final now = DateTime.now();
      await openUnlockedApp(
        tester,
        FakeBackend(
          history: [
            ChatMessage(isFromBuddy: false, text: 'Older', sentAt: DateTime(now.year - 1, 3, 4, 12)),
            ChatMessage(isFromBuddy: false, text: 'Newer', sentAt: now),
            ChatMessage(isFromBuddy: true, text: 'Also today', sentAt: now),
          ],
        ),
      );

      expect(find.text('Today'), findsOneWidget, reason: 'as the divider, since the tab bar shows only icons');
      expect(find.textContaining('Mar 4'), findsOneWidget);
    });

    testWidgets('offers a way back down from far up, and goes there', (tester) async {
      await openUnlockedApp(
        tester,
        FakeBackend(history: [for (var i = 0; i < 40; i++) buddy('Message number $i, long enough to take up some room on the screen.')]),
      );
      expect(find.text('Latest messages'), findsNothing);

      await tester.drag(find.byType(ListView).first, const Offset(0, 900));
      await tester.pump();
      expect(find.text('Latest messages'), findsOneWidget);

      await tester.tap(find.text('Latest messages'));
      await tester.pumpAndSettle();
      expect(find.text('Message number 39, long enough to take up some room on the screen.'), findsOneWidget);
      expect(find.text('Latest messages'), findsNothing);
    });

    testWidgets('says what the way back down does', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(
        tester,
        FakeBackend(history: [for (var i = 0; i < 40; i++) buddy('Message number $i, long enough to take up some room on the screen.')]),
      );

      await tester.drag(find.byType(ListView).first, const Offset(0, 900));
      await tester.pump();

      expect(tester.getSemantics(find.bySemanticsLabel('Go to the latest messages')), isSemantics(isButton: true, hasTapAction: true));
      handle.dispose();
    });

    testWidgets('goes straight down, without gliding, for a Student who has asked for less movement', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue = const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(tester.platformDispatcher.clearAccessibilityFeaturesTestValue);
      await openUnlockedApp(
        tester,
        FakeBackend(history: [for (var i = 0; i < 40; i++) buddy('Message number $i, long enough to take up some room on the screen.')]),
      );
      await tester.drag(find.byType(ListView).first, const Offset(0, 900));
      await tester.pump();

      await tester.tap(find.text('Latest messages'));
      await tester.pump();

      expect(tester.state<ScrollableState>(find.byType(Scrollable).first).position.pixels, 0);
    });

    testWidgets('long pressing a message copies it', (tester) async {
      final copied = <String>[];
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map<Object?, Object?>)['text']! as String);
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await openUnlockedApp(tester, FakeBackend(history: [student('Hello'), buddy('The office is open until five.')]));

      await tester.longPress(find.text('The office is open until five.'));
      await tester.pump();

      expect(copied, ['The office is open until five.']);
      expect(find.text('Copied the message.'), findsOneWidget);
    });
  });
}
