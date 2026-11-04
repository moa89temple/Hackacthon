// Draws every screen to a picture, with made-up content, for looking at the design without a phone or a backend.
//
//   cd app
//   flutter test test/visual/screens_tool.dart --dart-define=SCREENS_DIR=<folder>
//
// Its name doesn't end in _test.dart, so a plain `flutter test` leaves it out. Nothing it draws is ever in the app.

import 'dart:io';
import 'dart:ui' as ui;

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/briefings/briefing_backend.dart';
import 'package:buddy/device/app_lock.dart';
import 'package:buddy/roadmap/roadmap_backend.dart';
import 'package:buddy/sending/sending_backend.dart';
import 'package:buddy/spending/spending_backend.dart';
import 'package:buddy/tasks/task_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_backend.dart';
import '../support/test_app.dart';

const _outDir = String.fromEnvironment('SCREENS_DIR', defaultValue: 'build/screens');

/// The Flutter this is running under, which keeps the fonts its widget tests would otherwise do without.
final _sdk = Platform.resolvedExecutable.split(RegExp(r'[\\/]bin[\\/]cache[\\/]')).first;

Future<void> _loadFont(String family, List<String> files) async {
  final loader = FontLoader(family);
  for (final file in files) {
    final bytes = File('$_sdk/bin/cache/artifacts/material_fonts/$file').readAsBytesSync();
    loader.addFont(Future.value(ByteData.sublistView(bytes)));
  }
  await loader.load();
}

Future<void> _shoot(WidgetTester tester, String name) async {
  for (var frame = 0; frame < 6; frame++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.pump(const Duration(milliseconds: 400));
  final element = tester.element(find.byType(MaterialApp));
  await tester.runAsync(() async {
    RenderObject? render = element.renderObject;
    while (render != null && !render.isRepaintBoundary) {
      render = render.parent;
    }
    final layer = render!.debugLayer! as OffsetLayer;
    final image = await layer.toImage(render.paintBounds, pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('$_outDir/$name.png')..createSync(recursive: true);
    file.writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

GuidebookSource _source(String title) => GuidebookSource(url: 'https://www.temple.edu/$title', title: title, lastSeenAt: DateTime(2026, 11, 3));

const _canvasWarning =
    "Canvas's own rules forbid this. Instructure, which makes Canvas, says in its Acceptable Use Policy that you may not reach Canvas by any means other than its publicly supported interfaces, for example by \"scraping\". Its API Policy also bars technologies it hasn't approved. Buddy isn't approved by Instructure, and it reads your pages with its own browser. If Instructure or Temple objects, your Canvas account could be affected.";

Connection _connection(String id, String name, {bool on = false, bool needsLogin = false, DateTime? read, bool logsIn = true, String? why, String? problem}) => Connection(
      id: id,
      name: name,
      on: on,
      needsLogin: needsLogin,
      logsIn: logsIn,
      lastReadAt: read,
      lastReadProblem: problem,
      card: ReadPermissionCardContent(
        why: why,
        reads: const [
          "Your courses this term, and each course's term.",
          "Each course's assignments: the name, due dates, points, and whether it's submitted, late or missing.",
          'Your grades: your own score on each assignment and your total in each course, but not the class\'s averages.',
        ],
        notes: const [
          'Buddy opens only your course list, and the Assignments, Grades and Announcements pages of the courses you take. It also opens your Canvas home page to check that your login works.',
          "It never opens rosters or people pages, discussion boards, groups or classmates' work, quizzes or exams, or the pages where you submit an assignment. It never submits graded work, even if you tap Approve.",
          'You log in yourself through a Takeover, so Buddy never learns your password.',
          'Buddy reads it at 7 a.m., 1 p.m. and 7 p.m., and when you ask.',
        ],
        warning: logsIn ? _canvasWarning : null,
        address: id == 'google-calendar'
            ? const AddressRequest(label: 'Secret address in iCal format', steps: ['Open Google Calendar on a computer, at calendar.google.com.', 'Go to Settings, then pick your calendar.', 'Open "Integrate calendar" and copy the secret address.'])
            : null,
      ),
    );

FakeBackend _richBackend() {
  final goalA = const Goal(id: 1, text: 'Plan my semester');
  final goalB = const Goal(id: 2, text: 'Find an internship');
  final backend = FakeBackend(
    history: [
      const ChatMessage(isFromBuddy: true, text: "I'm Buddy, an AI assistant, and I won't do your graded work, pretend to be Temple staff or take the place of your advisors. I never do anything for you without your tap.\n\nWhat are you hoping to achieve at Temple? Knowing that helps me point you to the right people and resources, and you can skip it if you're not sure yet."),
      ChatMessage(isFromBuddy: false, text: 'I feel overwhelmed. Where should I start?', sentAt: DateTime.now()),
      ChatMessage(isFromBuddy: true, text: "Let's make the next step smaller. Your Roadmap is yours to change, and you can start with one thing.", sentAt: DateTime.now()),
    ],
  )
    ..goals = [goalA, goalB]
    ..milestones = [
      RoadmapMilestone(id: 1, done: false, goal: goalA, name: 'Prepare for your advisor meeting', detail: 'Write down the questions you want to ask.', when: 'November 12, 2026', sources: const [], sourceNote: 'You added this.', calendarUrl: 'https://calendar.google.com/calendar/render?x=1'),
      RoadmapMilestone(id: 2, done: false, goal: goalB, name: 'Update my résumé', detail: 'Add my latest experience.', when: 'November 20, 2026', sources: const [], sourceNote: 'You added this.', calendarUrl: 'https://calendar.google.com/calendar/render?x=2'),
      RoadmapMilestone(id: 3, done: false, goal: null, name: 'Register for spring classes', when: 'November 16, 2026', sources: [_source('Academic calendar')], calendarUrl: 'https://calendar.google.com/calendar/render?x=3'),
      RoadmapMilestone(id: 4, done: true, goal: goalA, name: 'Meet my professors in office hours', when: 'October 2, 2026', sources: const [], sourceNote: 'You added this.', calendarUrl: 'https://calendar.google.com/calendar/render?x=4'),
    ]
    ..connections = [
      _connection('google-calendar', 'Google Calendar', on: true, read: DateTime(2026, 11, 4, 7), logsIn: false, why: "So Buddy can see when you're free when it helps you plan."),
      _connection('canvas', 'Canvas', on: true, needsLogin: true, why: "So Buddy can tell you what's due and how your courses are going."),
      _connection('tuportal', 'TUportal', on: true, read: DateTime(2026, 11, 4, 7), problem: "Buddy couldn't read your holds."),
      _connection('dars', 'DARS'),
      _connection('tumail', 'TUmail'),
    ]
    ..upcoming = [
      StandardMilestone(id: 1, name: 'Last day to withdraw', term: 'Fall 2026', when: 'November 9, 2026', passed: false, sources: [_source('Academic calendar')]),
      StandardMilestone(id: 2, name: 'Spring registration opens', term: 'Spring 2027', when: 'November 16, 2026', passed: false, sources: [_source('Academic calendar')]),
    ]
    ..opportunities = [
      Opportunity(id: 1, name: 'Campus jobs fair', summary: 'Meet employers hiring students on campus.', when: 'November 18, 2026', cost: 'Free', outsideTemple: false, place: 'Howard Gittis Student Center', forGoals: const ['Find an internship'], saved: true, sources: [_source('Temple Careers')]),
      Opportunity(id: 2, name: 'Summer research program', summary: 'Ten paid weeks in a university lab.', when: 'Apply by January 15, 2027', cost: "Its Source doesn't say what this costs.", outsideTemple: true, saved: false, sources: [_source('Program page')]),
    ]
    ..tasks = const [
      Task(id: 1, title: 'Find internship Resources', state: 'working', stateText: 'Buddy is working on this.', steps: ['Searched for summer programs'], canCancel: true, spentNanodollars: 120000000),
    ]
    ..latestBriefing = Briefing(
      title: 'Your Briefing',
      when: 'Wednesday, November 4 at 8:00 AM',
      milestones: [
        BriefingMilestone(
          key: 'roadmap 1',
          milestone: const StandardMilestone(id: 1, name: 'Prepare for your advisor meeting', term: 'Write down the questions you want to ask.', when: 'November 6, 2026', passed: false, sources: []),
          goal: 'Plan my semester',
          sourceNote: 'You added this.',
        ),
      ],
      opportunities: const [],
      news: const [BriefingNews(id: 1, connection: 'Canvas', text: 'New announcement in Biology 1111')],
      moreNews: const [MoreBriefingNews(connection: 'TUmail', count: 3, words: 'And 3 new emails in TUmail.')],
      hadNothing: false,
    )
    ..facts = [
      ProfileFact(id: 1, text: 'Works 20 hours a week at a pharmacy.', isFromConversation: true, savedAt: DateTime(2026, 11, 1), wasEdited: false),
      ProfileFact(id: 2, text: 'Studying biology, second year.', isFromConversation: true, savedAt: DateTime(2026, 11, 1), wasEdited: true),
      ProfileFact(id: 3, text: 'Biology 1111: Lab report due Friday.', connectionName: 'Canvas', isFromConversation: false, savedAt: DateTime(2026, 11, 3), wasEdited: false),
      for (var i = 0; i < 6; i++) ProfileFact(id: 10 + i, text: 'Calendar event $i', detail: 'Tomorrow at 2:00 PM', connectionName: 'Google Calendar', isFromConversation: false, savedAt: DateTime(2026, 11, 3), wasEdited: false),
    ]
    ..activity = [
      ActivityEntry(kind: 'connection_read', title: 'Buddy read Canvas', detail: 'At the 7 a.m. read. 3 things changed.', at: DateTime(2026, 11, 4, 7)),
      ActivityEntry(kind: 'read_permission_given', title: 'You gave Buddy a Read Permission for Canvas', at: DateTime(2026, 11, 3, 18, 2)),
      ActivityEntry(
        kind: 'reply',
        title: 'Buddy replied',
        at: DateTime(2026, 11, 3, 17, 40),
        decision: const ReplyDecision(reply: "Let's make the next step smaller. Your Roadmap is yours to change.", tools: ['Searched the Guidebook'], sources: [DecisionSource(title: 'Student Success Center', url: 'https://studentsuccess.temple.edu')], facts: [DecisionFact(text: 'Works 20 hours a week at a pharmacy.', from: 'From your chat')]),
      ),
    ]
    ..sending = const SendingSettings(isLive: false, ownAddress: 'student@temple.edu')
    ..spendingSummary = const SpendingSummary(todayNanodollars: 120000000, thisMonthNanodollars: 3400000000, backgroundLimitNanodollars: 2000000000, backgroundStoppedForToday: false);
  backend.guidebook = [
    GuidebookItem(id: 1, name: 'Writing Center', summary: 'Student writers work with other student writers on any type of writing.', cost: 'Free', place: 'Charles Library', hours: 'Monday to Friday', sources: [_source('Writing Center')]),
    GuidebookItem(id: 2, name: 'Tuttleman Counseling Services', summary: 'Counseling for enrolled students, including same-day appointments.', cost: 'Free', phone: '(215) 204-7276', phoneToDial: '+12152047276', sources: [_source('Tuttleman Counseling')]),
    GuidebookItem(id: 3, isContact: true, name: 'Student Financial Services', summary: 'Help with bills, holds and financial aid.', phone: '(215) 204-2244', phoneToDial: '+12152042244', email: 'sfs@temple.edu', sources: [_source('Student Financial Services')]),
  ];
  return backend;
}

ActionCard _actionCard({bool live = false, String status = 'waiting', String statusText = 'Waiting for your tap.', bool canDecide = true}) => ActionCard(
      id: live ? 2 : 1,
      title: live ? 'Send a real email from your TUmail' : 'Send a practice email to yourself',
      shows: [
        if (live)
          const CardLine(label: 'Live', value: 'This really goes to your advisor.')
        else
          const CardLine(label: 'Practice mode', value: 'This goes to you, not to your advisor.'),
        const CardLine(label: 'To', value: 'student@temple.edu'),
        if (!live) const CardLine(label: 'In Live, this would go to', value: 'Your advisor <advisor@temple.edu>'),
        const CardLine(label: 'Subject', value: 'Question about my classes'),
        const CardLine(label: 'Message', value: 'Hello,\n\nCould we meet to discuss my classes?\n\nThank you.\n\nDrafted with help from Buddy, an AI assistant'),
      ],
      status: status,
      statusText: statusText,
      note: canDecide ? 'You can approve this until Wednesday, November 4 at 2:30 PM. Buddy will do it once, exactly as shown. If anything changes, it will ask you again.' : null,
      fingerprint: 'x',
      canDecide: canDecide,
    );

Future<void> _goTo(WidgetTester tester, String tab) async {
  await tester.tap(find.descendant(of: find.byKey(const ValueKey('nav')), matching: find.text(tab)));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}

Future<void> _openRow(WidgetTester tester, String words) async {
  for (var tries = 0; tries < 25 && find.text(words).evaluate().isEmpty; tries++) {
    await tester.drag(find.byType(ListView).first, const Offset(0, -300));
    await tester.pump(const Duration(milliseconds: 100));
  }
  await tester.ensureVisible(find.text(words).first);
  await tester.pump();
  await tester.tap(find.text(words).first);
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 400));
}

void _scenes(String suffix, Size size, double scale) {
  void scene(String name, Future<void> Function(WidgetTester tester, FakeBackend backend) body, {FakeBackend Function()? backend}) {
    testWidgets('$name$suffix', (tester) async {
      await tester.runAsync(() async {
        await _loadFont('Roboto', ['roboto-regular.ttf', 'roboto-medium.ttf', 'roboto-bold.ttf', 'roboto-black.ttf', 'roboto-italic.ttf']);
        await _loadFont('MaterialIcons', ['materialicons-regular.otf']);
      });
      tester.view.devicePixelRatio = 2;
      tester.view.physicalSize = size * 2;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(() {
        tester.view.resetDevicePixelRatio();
        tester.view.resetPhysicalSize();
        tester.platformDispatcher.clearAllTestValues();
      });
      final fake = (backend ?? _richBackend)();
      await openUnlockedApp(tester, fake, leftToItself: true);
      await tester.pump(const Duration(milliseconds: 200));
      await body(tester, fake);
    });
  }

  Future<void> shot(WidgetTester tester, String name) => _shoot(tester, '$name$suffix');

  scene('01-today', (tester, backend) async => shot(tester, '01-today'));
  scene('02-today-scrolled', (tester, backend) async {
    await tester.drag(find.byType(ListView).first, const Offset(0, -700));
    await shot(tester, '02-today-scrolled');
  });
  scene('03-buddy', (tester, backend) async {
    await _goTo(tester, 'Buddy');
    await shot(tester, '03-buddy');
  });
  scene(
    '04-buddy-first-run',
    (tester, backend) async => shot(tester, '04-buddy-first-run'),
    backend: () => FakeBackend(history: const [
      ChatMessage(isFromBuddy: true, text: "I'm Buddy, an AI assistant, and I won't do your graded work, pretend to be Temple staff or take the place of your advisors. I never do anything for you without your tap.\n\nWhat are you hoping to achieve at Temple? Knowing that helps me point you to the right people and resources, and you can skip it if you're not sure yet."),
    ]),
  );
  scene('05-roadmap', (tester, backend) async {
    await _goTo(tester, 'Roadmap');
    await shot(tester, '05-roadmap');
  });
  scene('06-you', (tester, backend) async {
    await _goTo(tester, 'You');
    await shot(tester, '06-you');
  });
  scene('07-action-card', (tester, backend) async {
    await _goTo(tester, 'Buddy');
    await shot(tester, '07-action-card');
  }, backend: () => _richBackend()..history = [ActionCardItem(_actionCard())]);
  scene('08-action-live', (tester, backend) async {
    await _goTo(tester, 'Buddy');
    await shot(tester, '08-action-live');
  }, backend: () => _richBackend()..history = [ActionCardItem(_actionCard(live: true, status: 'unknown', statusText: "Buddy can't tell whether this happened. It won't try again, so please check.", canDecide: false))]);
  scene('09-crisis', (tester, backend) async {
    await _goTo(tester, 'Buddy');
    await shot(tester, '09-crisis');
  }, backend: () => _richBackend()..history = [ChatMessage(isFromBuddy: false, text: "I don't want to be here anymore.", sentAt: DateTime.now()), CrisisCardItem()]);
  scene('10-draft', (tester, backend) async {
    await _goTo(tester, 'Buddy');
    await shot(tester, '10-draft');
  }, backend: () => _richBackend()..history = [DraftCardItem(const Draft(id: 1, contact: GuidebookItem(id: 3, name: 'Student Financial Services', summary: 'x', email: 'sfs@temple.edu', sources: []), why: 'They handle holds on student accounts.', subject: 'A hold on my account', body: 'Hello,\n\nI have a hold on my account and I would like to understand how to clear it.\n\nThank you.\n\nDrafted with help from Buddy, an AI assistant'))]);
  scene('11-permission-prompt', (tester, backend) async {
    await _goTo(tester, 'Buddy');
    await shot(tester, '11-permission-prompt');
  }, backend: () => _richBackend()..history = [const ReadPermissionCardItem('dars')]);
  scene('12-read-permission', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Connections');
    await shot(tester, '12-connections');
    await _openRow(tester, 'DARS');
    await shot(tester, '13-read-permission');
    await tester.drag(find.byType(ListView).last, const Offset(0, -900));
    await shot(tester, '14-read-permission-end');
  });
  scene('15-calendar-permission', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Connections');
    await _openRow(tester, 'Canvas');
    await shot(tester, '15-connection-detail');
  });
  scene('16-profile', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Profile');
    await shot(tester, '16-profile');
  });
  scene('17-nudges', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Nudges');
    await shot(tester, '17-nudges');
  });
  scene('18-email', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Email Buddy sends');
    await shot(tester, '18-email');
  });
  scene('19-activity', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Activity');
    await shot(tester, '19-activity');
  });
  scene('20-spent', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'What Buddy spent');
    await shot(tester, '20-spent');
  });
  scene('21-goals', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Your Goals');
    await shot(tester, '21-goals');
  });
  scene('22-help', (tester, backend) async {
    await _goTo(tester, 'You');
    await _openRow(tester, 'Need help right now?');
    await shot(tester, '22-help');
  });
  scene('23-guidebook', (tester, backend) async {
    await _openRow(tester, 'Guidebook');
    await shot(tester, '23-guidebook');
    await _openRow(tester, 'Tuttleman Counseling Services');
    await shot(tester, '24-guidebook-item');
  });
  scene('25-opportunities', (tester, backend) async {
    await _openRow(tester, 'See Opportunities');
    await shot(tester, '25-opportunities');
  });
  scene('26-milestone', (tester, backend) async {
    await _goTo(tester, 'Roadmap');
    await _openRow(tester, 'Prepare for your advisor meeting');
    await shot(tester, '26-milestone');
  });
  scene('27-organize', (tester, backend) async {
    await _goTo(tester, 'Roadmap');
    await _openRow(tester, 'Organize');
    await shot(tester, '27-organize');
  });
  scene('28-add-milestone', (tester, backend) async {
    await _goTo(tester, 'Roadmap');
    await _openRow(tester, 'Add a Milestone');
    await shot(tester, '28-add-milestone');
  });
  scene('29-task', (tester, backend) async {
    await _openRow(tester, 'Find internship Resources');
    await shot(tester, '29-task');
  });
  void entryScene(String name, Widget Function() app) {
    testWidgets('$name$suffix', (tester) async {
      await tester.runAsync(() async {
        await _loadFont('Roboto', ['roboto-regular.ttf', 'roboto-medium.ttf', 'roboto-bold.ttf', 'roboto-black.ttf', 'roboto-italic.ttf']);
        await _loadFont('MaterialIcons', ['materialicons-regular.otf']);
      });
      tester.view.devicePixelRatio = 2;
      tester.view.physicalSize = size * 2;
      tester.platformDispatcher.textScaleFactorTestValue = scale;
      addTearDown(() {
        tester.view.resetDevicePixelRatio();
        tester.view.resetPhysicalSize();
        tester.platformDispatcher.clearAllTestValues();
      });
      await tester.pumpWidget(app());
      await settleApp(tester);
      await shot(tester, name);
    });
  }

  entryScene('32-pairing', () => testApp(store: FakeDeviceStore(), lock: FakeAppLock(), access: FakeBackendAccess(FakeBackend())));
  entryScene('33-lock', () => testApp(store: FakeDeviceStore(testDevice), lock: FakeAppLock([UnlockResult.failed]), access: FakeBackendAccess(FakeBackend())));
  scene('34-takeover', (tester, backend) async {
    backend.takeoverToStart = canvasTakeover;
    await _goTo(tester, 'You');
    await _openRow(tester, 'Connections');
    await _openRow(tester, 'Canvas');
    await _openRow(tester, 'Log in to Canvas');
    await shot(tester, '34-takeover');
  });
  scene('35-login-step', (tester, backend) async {
    backend.connectionAfterGive = _connection('dars', 'DARS', on: true, needsLogin: true);
    await _goTo(tester, 'You');
    await _openRow(tester, 'Connections');
    await _openRow(tester, 'DARS');
    await _openRow(tester, 'Give Read Permission');
    await shot(tester, '35-login-step');
  });
  scene('30-empty-today', (tester, backend) async {
    await _goTo(tester, 'Today');
    await shot(tester, '30-empty-today');
    await _goTo(tester, 'Roadmap');
    await shot(tester, '31-empty-roadmap');
  }, backend: () => FakeBackend(history: [ChatMessage(isFromBuddy: false, text: 'Hi', sentAt: DateTime.now())]));
}

void main() {
  _scenes('', const Size(390, 844), 1);
  _scenes('-large', const Size(360, 640), 2);
}
