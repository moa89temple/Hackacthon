import 'dart:async';
import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/crisis_card.dart';
import 'package:buddy/roadmap/roadmap_backend.dart';
import 'package:buddy/roadmap/roadmap_controller.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/fake_roadmap.dart';
import 'support/test_app.dart';

Future<void> openTab(WidgetTester tester, FakeBackend backend, String name, {PhoneOpener openPhone = pretendToOpenPhone}) async {
  await openUnlockedApp(tester, backend, openPhone: openPhone);
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text(name)));
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

/// A chat with a Roadmap card in it, from the Student's latest message.
Future<void> openChatWithCard(WidgetTester tester, FakeBackend backend, {PhoneOpener openPhone = pretendToOpenPhone}) async {
  await openUnlockedApp(tester, backend, openPhone: openPhone);
  await tester.pumpAndSettle();
}

Finder get acceptButton => find.widgetWithText(FilledButton, 'Accept');

void main() {
  group('the Goals on the You tab', () {
    testWidgets('shows each of several Goals', (tester) async {
      final backend = FakeBackend()..goals = [paSchool, const Goal(id: 2, text: 'Graduate in four years')];

      await openTab(tester, backend, 'You');

      expect(find.text('Your Goals'), findsOneWidget);
      expect(find.text('Get into PA school'), findsOneWidget);
      expect(find.text('Graduate in four years'), findsOneWidget);
    });

    testWidgets('says Buddy can help when there are none', (tester) async {
      await openTab(tester, FakeBackend(), 'You');

      expect(find.textContaining('Buddy can help you choose one'), findsOneWidget);
    });

    testWidgets('lets the Student add one', (tester) async {
      final backend = FakeBackend();
      await openTab(tester, backend, 'You');

      await tapThrough(tester, find.text('Add a Goal'));
      await tester.enterText(find.widgetWithText(TextField, 'Goal'), 'Study abroad');
      await tester.pump();
      await tapThrough(tester, find.text('Save'));

      expect(backend.goals.map((goal) => goal.text), ['Study abroad']);
      expect(find.text('Study abroad'), findsOneWidget);
    });

    testWidgets('lets the Student change one', (tester) async {
      final backend = FakeBackend()..goals = [paSchool];
      await openTab(tester, backend, 'You');

      await tapThrough(tester, find.bySemanticsLabel('Edit Goal: Get into PA school'));
      await tester.enterText(find.widgetWithText(TextField, 'Goal'), 'Become a PA');
      await tester.pump();
      await tapThrough(tester, find.text('Save'));

      expect(backend.goals.single.text, 'Become a PA');
    });

    testWidgets('warns that removing one takes its Milestones with it, and removes them both', (tester) async {
      final backend = FakeBackend()
        ..goals = [paSchool]
        ..milestones = [planTerm(), unwrittenRule()];
      await openTab(tester, backend, 'You');

      await tapThrough(tester, find.bySemanticsLabel('Remove Goal: Get into PA school'));

      expect(find.textContaining('1 Milestone on your Roadmap goes with it'), findsOneWidget);
      await tapThrough(tester, find.descendant(of: find.byType(AlertDialog), matching: find.text('Remove')));

      expect(backend.goals, isEmpty);
      expect(backend.milestones.map((milestone) => milestone.id), [2]);
      expect(find.text('Get into PA school'), findsNothing);
    });

    testWidgets('says so, in a live region, when a change does not go through', (tester) async {
      final backend = FakeBackend()
        ..goals = [paSchool]
        ..roadmapChangeError = Exception('no connection');
      await openTab(tester, backend, 'You');
      final handle = tester.ensureSemantics();

      await tapThrough(tester, find.bySemanticsLabel('Remove Goal: Get into PA school'));
      await tapThrough(tester, find.descendant(of: find.byType(AlertDialog), matching: find.text('Remove')));

      final problem = find.textContaining('so nothing changed');
      expect(tester.getSemantics(problem).flagsCollection.isLiveRegion, isTrue);
      expect(find.text('Get into PA school'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('picks up a Goal saved in the chat when the Student comes to the tab', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      backend.goals = [paSchool];

      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await tester.pumpAndSettle();

      expect(find.text('Get into PA school'), findsOneWidget);
    });
  });

  group('the Roadmap card in the chat', () {
    testWidgets('shows what it proposes, each with its badge, date and Source', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())]);
      await openChatWithCard(tester, backend);

      expect(find.text('Your first Roadmap'), findsOneWidget);
      expect(find.text('This fits getting into PA school.'), findsOneWidget);
      expect(find.textContaining('Uses the Suggested Academic Plan'), findsOneWidget);
      expect(find.text('Finish your Year 2 Fall courses'), findsOneWidget);
      expect(find.text('Goal: Get into PA school'), findsOneWidget);
      expect(find.text('By the end of Fall 2026'), findsOneWidget);
      expect(find.text('Standard Milestone'), findsOneWidget);
      expect(find.text('From: $bulletinTitle'), findsOneWidget);
      expect(find.text('Source: $bulletinTitle'), findsOneWidget);
      expect(find.text('General college advice from Buddy, not from a Temple page.'), findsOneWidget);
      expect(acceptButton, findsOneWidget);
      expect(find.text('Not now'), findsOneWidget);
    });

    testWidgets('accepts with one tap, and only that tap', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())])
        ..answerToAccept = RoadmapCardAnswer(card: firstCard(status: RoadmapCardStatus.accepted), milestones: [planTerm(), unwrittenRule()]);
      await openChatWithCard(tester, backend);
      expect(backend.accepted, isEmpty);

      await tapThrough(tester, acceptButton);

      expect(backend.accepted, [5]);
      expect(find.textContaining("It's on your Roadmap tab"), findsOneWidget);
      expect(acceptButton, findsNothing);
    });

    testWidgets('puts it on the Roadmap tab straight away', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())])
        ..answerToAccept = RoadmapCardAnswer(card: firstCard(status: RoadmapCardStatus.accepted), milestones: [planTerm()]);
      await openChatWithCard(tester, backend);

      await tapThrough(tester, acceptButton);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Roadmap')));
      await tester.pumpAndSettle();

      expect(find.text('Finish your Year 2 Fall courses'), findsOneWidget);
    });

    testWidgets('takes one tap at a time, however fast the Student taps', (tester) async {
      final hold = Completer<void>();
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())])
        ..holdCardTap = hold
        ..answerToAccept = RoadmapCardAnswer(card: firstCard(status: RoadmapCardStatus.accepted), milestones: [planTerm()]);
      await openChatWithCard(tester, backend);
      await tester.ensureVisible(acceptButton);
      await tester.pumpAndSettle();

      await tester.tap(acceptButton);
      await tester.pump();
      await tester.tap(acceptButton, warnIfMissed: false);
      await tester.pump();

      expect(backend.accepted, [5]);
      hold.complete();
      await tester.pumpAndSettle();
    });

    testWidgets('reads out what became of it after a tap, and not when the conversation loads', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())])
        ..answerToAccept = RoadmapCardAnswer(card: firstCard(status: RoadmapCardStatus.accepted), milestones: [planTerm()]);
      await openChatWithCard(tester, backend);
      final handle = tester.ensureSemantics();

      await tapThrough(tester, acceptButton);

      expect(tester.getSemantics(find.textContaining("It's on your Roadmap tab")).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('does not read out what became of a card from earlier', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard(status: RoadmapCardStatus.accepted))]);
      await openChatWithCard(tester, backend);
      final handle = tester.ensureSemantics();
      await tester.pump();

      expect(tester.getSemantics(find.textContaining("It's on your Roadmap tab")).flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('shows a card left by a read when the Student comes back to the Buddy tab, and reads it out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend(history: [student('Hello')]);
      await openTab(tester, backend, 'You');
      expect(acceptButton, findsNothing);

      backend.history = [student('Hello'), RoadmapCardItem(firstCard())];
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await tester.pumpAndSettle();

      expect(acceptButton, findsOneWidget);
      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Roadmap card: Your first Roadmap'))).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('stops offering a card that a read has stopped working', (tester) async {
      final backend = FakeBackend(history: [student('Hello'), RoadmapCardItem(firstCard())]);
      await openTab(tester, backend, 'You');

      backend.history = [student('Hello'), RoadmapCardItem(firstCard(status: RoadmapCardStatus.outOfDate))];
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await tester.pumpAndSettle();

      expect(acceptButton, findsNothing);
    });

    testWidgets('leaves the conversation as it is when nothing about the cards is new', (tester) async {
      final backend = FakeBackend(history: [student('Hello')]);
      await openTab(tester, backend, 'You');

      backend.history = [student('Something that would only show if the list were swapped')];
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Buddy')));
      await tester.pumpAndSettle();

      expect(find.text('Hello'), findsOneWidget);
    });

    testWidgets('changes nothing on Not now, and says so', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())])
        ..answerToNotNow = RoadmapCardAnswer(card: firstCard(status: RoadmapCardStatus.notNow), milestones: const []);
      await openChatWithCard(tester, backend);

      await tapThrough(tester, find.text('Not now'));

      expect(backend.saidNotNow, [5]);
      expect(backend.milestones, isEmpty);
      expect(find.textContaining('You said not now'), findsOneWidget);
    });

    testWidgets('says nothing changed if the tap does not go through, and can be tapped again', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())])
        ..roadmapChangeError = Exception('no connection');
      await openChatWithCard(tester, backend);
      final handle = tester.ensureSemantics();

      await tapThrough(tester, acceptButton);

      final problem = find.textContaining('so nothing changed');
      expect(tester.getSemantics(problem).flagsCollection.isLiveRegion, isTrue);
      expect(acceptButton, findsOneWidget);
      handle.dispose();
    });

    for (final (status, words) in [
      (RoadmapCardStatus.accepted, "It's on your Roadmap tab"),
      (RoadmapCardStatus.notNow, 'You said not now'),
      (RoadmapCardStatus.replaced, 'newer card'),
      (RoadmapCardStatus.outOfDate, 'out of date'),
    ]) {
      testWidgets('shows a card that is ${status.name} without its buttons', (tester) async {
        final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard(status: status))]);
        await openChatWithCard(tester, backend);

        expect(find.textContaining(words), findsOneWidget);
        expect(acceptButton, findsNothing);
        expect(find.text('Not now'), findsNothing);
      });
    }

    testWidgets('stops offering Accept on an earlier card as soon as a newer one arrives', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())]);
      await openChatWithCard(tester, backend);
      await sendMessage(tester, 'Try again');

      backend.reply.add(ReplyRoadmapCard(firstCard(id: 7)));
      await tester.pump();
      await tester.pump();

      expect(acceptButton, findsOneWidget);
      await tester.dragUntilVisible(find.textContaining('newer card'), find.byType(ListView).first, const Offset(0, 200));
      expect(find.textContaining('newer card'), findsOneWidget);
    });

    testWidgets('shows what a later change adds and removes', (tester) async {
      final backend = FakeBackend(history: [student('Add something'), RoadmapCardItem(changeCard())]);
      await openChatWithCard(tester, backend);

      expect(find.text('A change to your Roadmap'), findsOneWidget);
      expect(find.text('Since you want to shadow sooner.'), findsOneWidget);
      expect(find.text('Email a PA about shadowing'), findsOneWidget);
      expect(find.text('Takes off: Finish your Year 2 Fall courses'), findsOneWidget);
      expect(acceptButton, findsOneWidget);
    });

    testWidgets('opens a Source when it is tapped', (tester) async {
      final opened = <Uri>[];
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())]);
      await openChatWithCard(
        tester,
        backend,
        openPhone: (address) async {
          opened.add(address);
          return true;
        },
      );

      await tapThrough(tester, find.text('Source: $bulletinTitle'));

      expect(opened, [Uri.parse(bulletinPage)]);
    });

    testWidgets('arrives during a turn and is read out', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await tester.pumpAndSettle();
      final handle = tester.ensureSemantics();
      await sendMessage(tester, 'Make me a Roadmap');

      backend.reply.add(ReplyRoadmapCard(firstCard()));
      await tester.pump();
      await tester.pump();

      final label = find.bySemanticsLabel(RegExp('^Roadmap card: Your first Roadmap'));
      expect(tester.getSemantics(label).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('is not read out when the conversation loads', (tester) async {
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())]);
      await openChatWithCard(tester, backend);
      final handle = tester.ensureSemantics();
      await tester.pump();

      final label = find.bySemanticsLabel(RegExp('^Roadmap card: Your first Roadmap'));
      expect(tester.getSemantics(label).flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('keeps the top of a tall card where the Student can scroll to it, even while the reply arrives', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final tall = firstCard(milestones: [for (var id = 1; id <= 14; id++) planTerm(id: id, name: 'Milestone number $id')]);
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await tester.pumpAndSettle();
      await sendMessage(tester, 'Make me a Roadmap');
      backend.reply.add(ReplyRoadmapCard(tall));
      await tester.pump();
      await tester.pump();

      await tester.dragUntilVisible(find.text('Your first Roadmap'), find.byType(ListView).first, const Offset(0, 200));
      await tester.pumpAndSettle();
      final titleAt = tester.getTopLeft(find.text('Your first Roadmap')).dy;

      backend.reply.add(const ReplyText('Here it is.'));
      await tester.pump();
      await tester.pump();
      backend.reply
        ..add(ReplyDone(buddy('Here it is. Tap Accept when you are happy.')))
        ..close();
      await tester.pumpAndSettle();

      final titleNow = find.text('Your first Roadmap');
      expect(titleNow.hitTestable(), findsOneWidget);
      // The reply below it pushes it up by the reply's height at most: nothing jumps it off the screen.
      expect(tester.getTopLeft(titleNow).dy, lessThanOrEqualTo(titleAt));
      expect(tester.takeException(), isNull);
    });

    testWidgets('fits at twice the text size on a small phone, and its buttons can be reached', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final backend = FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())]);
      await openChatWithCard(tester, backend);

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(acceptButton);
      await tester.pumpAndSettle();
      expect(acceptButton.hitTestable(), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('meets the tap target, label and contrast guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await openChatWithCard(tester, FakeBackend(history: [student('Make me a Roadmap'), RoadmapCardItem(firstCard())]));

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });
  });

  group('the Roadmap tab', () {
    testWidgets('helps a Student with no Goal choose one, by asking Buddy', (tester) async {
      final backend = FakeBackend();
      await openTab(tester, backend, 'Roadmap');

      expect(find.textContaining("You don't have a Roadmap yet"), findsOneWidget);
      await tapThrough(tester, find.text('Choose a Goal with Buddy'));

      expect(backend.sent, ['Help me choose a Goal.']);
      expect(find.text('Message Buddy'), findsOneWidget);
    });

    testWidgets('offers a Student with a Goal their first Roadmap', (tester) async {
      final backend = FakeBackend()..goals = [paSchool];
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.text('Ask Buddy for your Roadmap'));

      expect(backend.sent, ['Please make me a Roadmap.']);
    });

    testWidgets('shows the Milestones in order, each with its badge, its due date and its Source', (tester) async {
      final backend = FakeBackend()
        ..goals = [paSchool]
        ..milestones = [planTerm(), unwrittenRule()];
      await openTab(tester, backend, 'Roadmap');

      expect(tester.getTopLeft(find.text('Finish your Year 2 Fall courses')).dy, lessThan(tester.getTopLeft(find.text('Go to office hours in your first few weeks of class')).dy));
      expect(find.text('Goal: Get into PA school'), findsOneWidget);
      expect(find.text('Standard Milestone'), findsOneWidget);
      expect(find.text('By the end of Fall 2026'), findsOneWidget);
      expect(find.text('Early in Spring 2027'), findsOneWidget);
      expect(find.text('Source: $bulletinTitle'), findsOneWidget);
      expect(find.text('General college advice from Buddy, not from a Temple page.'), findsOneWidget);
    });

    testWidgets('says when a date has left its Source', (tester) async {
      final backend = FakeBackend()
        ..milestones = [
          RoadmapMilestone(
            id: 1,
            done: false,
            goneFromSource: true,
            goal: null,
            name: 'Priority registration',
            when: 'Monday, March 29, 2027',
            sources: [bulletinSource],
            calendarUrl: calendarLinkForTests,
          ),
        ];
      await openTab(tester, backend, 'Roadmap');

      expect(find.textContaining('gone from its Source'), findsOneWidget);
    });

    testWidgets('marks a Milestone done and back', (tester) async {
      final backend = FakeBackend()..milestones = [planTerm()];
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.bySemanticsLabel('Done: Finish your Year 2 Fall courses'));
      expect(backend.milestones.single.done, isTrue);
      expect(find.text('Done'), findsOneWidget);

      await tapThrough(tester, find.bySemanticsLabel('Done: Finish your Year 2 Fall courses'));
      expect(backend.milestones.single.done, isFalse);
    });

    testWidgets('reorders them, and neither end moves past the end', (tester) async {
      final backend = FakeBackend()..milestones = [planTerm(id: 1, name: 'First'), planTerm(id: 2, name: 'Second')];
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.byTooltip('Move down: First'));

      expect(backend.orders, [
        [2, 1],
      ]);
      expect(tester.getTopLeft(find.text('Second')).dy, lessThan(tester.getTopLeft(find.text('First')).dy));
      expect(tester.widget<IconButton>(find.widgetWithIcon(IconButton, Icons.arrow_upward).first).onPressed, isNull);
    });

    testWidgets('removes one after asking, which it does not undo', (tester) async {
      final backend = FakeBackend()..milestones = [planTerm()];
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.byTooltip('Remove: Finish your Year 2 Fall courses'));
      await tapThrough(tester, find.text('Cancel'));
      expect(backend.milestones, hasLength(1));

      await tapThrough(tester, find.byTooltip('Remove: Finish your Year 2 Fall courses'));
      await tapThrough(tester, find.widgetWithText(TextButton, 'Remove'));

      expect(backend.milestones, isEmpty);
    });

    testWidgets('adds one of the Student\'s own, for a Goal or as Standard', (tester) async {
      final backend = FakeBackend()
        ..goals = [paSchool]
        ..milestones = [planTerm()];
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.text('Add a Milestone'));
      await tester.enterText(find.widgetWithText(TextField, 'What to do or decide'), 'Apply to PA programs');
      await tester.pump();
      await tapThrough(tester, find.text('Choose a date'));
      await tapThrough(tester, find.text('OK'));
      await tapThrough(tester, find.text('Standard Milestone, for no one Goal'));
      await tapThrough(tester, find.text('Get into PA school').last);
      await tapThrough(tester, find.text('Save'));

      final added = backend.added.single;
      expect(added.name, 'Apply to PA programs');
      expect(added.goalId, 1);
      expect(added.dueDate, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
      expect(find.text('Apply to PA programs'), findsOneWidget);
    });

    testWidgets('will not save a Milestone with no name or no date', (tester) async {
      final backend = FakeBackend()..milestones = [planTerm()];
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.text('Add a Milestone'));

      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save')).onPressed, isNull);
      await tester.enterText(find.widgetWithText(TextField, 'What to do or decide'), 'Apply to PA programs');
      await tester.pump();
      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save')).onPressed, isNull);
    });

    testWidgets('has an Add to Google Calendar link that the Student taps, and only that opens it', (tester) async {
      final opened = <Uri>[];
      final backend = FakeBackend()..milestones = [planTerm()];
      await openTab(
        tester,
        backend,
        'Roadmap',
        openPhone: (address) async {
          opened.add(address);
          return true;
        },
      );
      expect(opened, isEmpty);

      await tapThrough(tester, find.text('Add to Google Calendar'));

      expect(opened, [Uri.parse(calendarLinkForTests)]);
    });

    testWidgets('will not open a calendar link that is not Google\'s', (tester) async {
      final opened = <Uri>[];
      final backend = FakeBackend()
        ..milestones = [
          RoadmapMilestone(id: 1, done: false, goal: null, name: 'Odd', when: 'Soon', sources: const [], calendarUrl: 'https://evil.test/calendar'),
        ];
      await openTab(
        tester,
        backend,
        'Roadmap',
        openPhone: (address) async {
          opened.add(address);
          return true;
        },
      );

      expect(tester.widget<TextButton>(find.widgetWithText(TextButton, 'Add to Google Calendar')).onPressed, isNull);
      expect(opened, isEmpty);
    });

    testWidgets('says so when the phone cannot open a link', (tester) async {
      final backend = FakeBackend()..milestones = [planTerm()];
      await openTab(tester, backend, 'Roadmap', openPhone: (address) async => false);

      await tapThrough(tester, find.text('Add to Google Calendar'));

      expect(find.textContaining("couldn't open that"), findsOneWidget);
    });

    testWidgets('says so when it cannot load, and can try again', (tester) async {
      final backend = FakeBackend()..roadmapError = Exception('no connection');
      await openTab(tester, backend, 'Roadmap');

      expect(find.textContaining("couldn't load your Roadmap"), findsOneWidget);
      backend
        ..roadmapError = null
        ..milestones = [planTerm()];
      await tapThrough(tester, find.text('Try again'));

      expect(find.text('Finish your Year 2 Fall courses'), findsOneWidget);
    });

    testWidgets('says so when a change does not go through, and shows the list as it was', (tester) async {
      final backend = FakeBackend()
        ..milestones = [planTerm()]
        ..roadmapChangeError = Exception('no connection');
      await openTab(tester, backend, 'Roadmap');

      await tapThrough(tester, find.bySemanticsLabel('Done: Finish your Year 2 Fall courses'));

      expect(find.textContaining('so nothing changed'), findsOneWidget);
      expect(find.text('Finish your Year 2 Fall courses'), findsOneWidget);
      expect(find.text('Done'), findsNothing);
    });

    testWidgets('shows a problem even when the Student has scrolled far down the list', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final backend = FakeBackend()
        ..milestones = [for (var id = 1; id <= 8; id++) planTerm(id: id, name: 'Milestone number $id')]
        ..roadmapChangeError = Exception('no connection');
      await openTab(tester, backend, 'Roadmap');

      await tester.scrollUntilVisible(find.byTooltip('Remove: Milestone number 5'), 300);
      await tapThrough(tester, find.bySemanticsLabel('Done: Milestone number 5'));

      final problem = find.textContaining('so nothing changed');
      expect(problem, findsOneWidget);
      expect(tester.getTopLeft(problem).dy, lessThan(tester.getTopLeft(find.byType(ListView).first).dy));
      expect(tester.takeException(), isNull);
    });

    testWidgets('picks up what changed in a turn when the Student comes to the tab', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      backend.milestones = [planTerm()];

      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Roadmap')));
      await tester.pumpAndSettle();

      expect(find.text('Finish your Year 2 Fall courses'), findsOneWidget);
    });

    group('with a screen reader', () {
      testWidgets('reads each Milestone as one item, with its place, badge, date and whether it is done', (tester) async {
        final handle = tester.ensureSemantics();
        await openTab(tester, FakeBackend()..milestones = [planTerm(done: true), unwrittenRule()], 'Roadmap');

        expect(
          find.bySemanticsLabel(RegExp(r'^Milestone 1 of 2: Finish your Year 2 Fall courses\. Goal: Get into PA school\. By the end of Fall 2026\. Done\.')),
          findsOneWidget,
        );
        expect(find.bySemanticsLabel(RegExp(r'^Milestone 2 of 2: Go to office hours .*\. Standard Milestone\. Early in Spring 2027\.')), findsOneWidget);
        handle.dispose();
      });

      testWidgets('names the Milestone on each control, because they repeat down the list', (tester) async {
        final handle = tester.ensureSemantics();
        await openTab(tester, FakeBackend()..milestones = [planTerm()], 'Roadmap');
        final name = 'Finish your Year 2 Fall courses';

        expect(find.bySemanticsLabel('Done: $name'), findsOneWidget);
        expect(find.byTooltip('Remove: $name'), findsOneWidget);
        expect(find.byTooltip('Move up: $name'), findsOneWidget);
        expect(find.byTooltip('Move down: $name'), findsOneWidget);
        expect(find.bySemanticsLabel('Add to Google Calendar: $name'), findsOneWidget);
        expect(find.bySemanticsLabel(RegExp('^Open Source: $bulletinTitle')), findsOneWidget);
        handle.dispose();
      });

      testWidgets('has a heading, and meets the tap target, label and contrast guidelines', (tester) async {
        final handle = tester.ensureSemantics();
        await openTab(tester, FakeBackend()..milestones = [planTerm(), unwrittenRule()], 'Roadmap');

        expect(tester.getSemantics(find.text('Your Roadmap')).flagsCollection.isHeader, isTrue);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        handle.dispose();
      });

      testWidgets('the Goals on the You tab do too', (tester) async {
        final handle = tester.ensureSemantics();
        await openTab(tester, FakeBackend()..goals = [paSchool], 'You');

        expect(tester.getSemantics(find.text('Your Goals')).flagsCollection.isHeader, isTrue);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        handle.dispose();
      });
    });

    group('with twice the text size on a small phone', () {
      testWidgets('fits, and every control can be reached', (tester) async {
        useSmallPhoneWithLargeText(tester);
        final backend = FakeBackend()..milestones = [planTerm(), unwrittenRule()];
        await openTab(tester, backend, 'Roadmap');
        expect(tester.takeException(), isNull);

        await tester.scrollUntilVisible(find.byTooltip('Remove: Finish your Year 2 Fall courses'), 200);
        await tapThrough(tester, find.byTooltip('Remove: Finish your Year 2 Fall courses'));
        expect(tester.takeException(), isNull);
        await tapThrough(tester, find.text('Cancel'));

        await tester.scrollUntilVisible(find.text('Add to Google Calendar').first, 200);
        await tapThrough(tester, find.text('Add to Google Calendar').first);
        expect(tester.takeException(), isNull);
      });

      testWidgets('the add screen fits too', (tester) async {
        useSmallPhoneWithLargeText(tester);
        await openTab(tester, FakeBackend()..milestones = [planTerm()]..goals = [paSchool], 'Roadmap');

        await tapThrough(tester, find.text('Add a Milestone'));

        expect(tester.takeException(), isNull);
        await tester.ensureVisible(find.widgetWithText(FilledButton, 'Save'));
        await tester.pumpAndSettle();
        expect(find.widgetWithText(FilledButton, 'Save').hitTestable(), findsOneWidget);
      });

      testWidgets('the Goals on the You tab fit too', (tester) async {
        useSmallPhoneWithLargeText(tester);
        await openTab(tester, FakeBackend()..goals = [paSchool], 'You');

        expect(tester.takeException(), isNull);
      });
    });
  });

  group('changes that overlap', () {
    test('each one goes through, in order, rather than the later one being dropped', () async {
      final backend = FakeBackend()..holdChange = Completer<void>();
      final hold = backend.holdChange!;
      final roadmap = RoadmapController(backend);
      await roadmap.load();

      final first = roadmap.addGoal('First');
      final second = roadmap.addGoal('Second');
      hold.complete();
      await Future.wait([first, second]);

      expect(roadmap.goals!.map((goal) => goal.text), ['First', 'Second']);
      expect(roadmap.isChanging, isFalse);
    });

    test('a move works from the list as it is by then', () async {
      final backend = FakeBackend()
        ..milestones = [planTerm(id: 1, name: 'A'), planTerm(id: 2, name: 'B'), planTerm(id: 3, name: 'C')];
      final roadmap = RoadmapController(backend);
      await roadmap.load();
      backend.holdChange = Completer<void>();
      final hold = backend.holdChange!;

      final first = roadmap.move(roadmap.milestones![0], by: 1);
      final second = roadmap.move(roadmap.milestones![0], by: 1);
      hold.complete();
      await Future.wait([first, second]);

      expect(roadmap.milestones!.map((milestone) => milestone.name), ['B', 'C', 'A']);
    });

    test('a load that started during a change can\'t bring back the old list', () async {
      final backend = FakeBackend()..milestones = [planTerm(id: 1, name: 'A'), planTerm(id: 2, name: 'B')];
      final roadmap = RoadmapController(backend);
      await roadmap.load();
      final changeHeld = Completer<void>();
      final loadHeld = Completer<void>();
      backend.holdChange = changeHeld;

      final removing = roadmap.remove(roadmap.milestones![0]);
      backend.holdRoadmapLoad = loadHeld;
      final loading = roadmap.load();
      await Future<void>.delayed(Duration.zero);
      changeHeld.complete();
      await removing;
      loadHeld.complete();
      await loading;

      expect(roadmap.milestones!.map((milestone) => milestone.name), ['B']);
    });

    test('a change that fails says so and lets the next one through', () async {
      final backend = FakeBackend()..roadmapChangeError = Exception('no connection');
      final roadmap = RoadmapController(backend);
      await roadmap.load();

      await roadmap.addGoal('First');
      expect(roadmap.problem, contains('so nothing changed'));

      backend.roadmapChangeError = null;
      await roadmap.addGoal('Second');
      expect(roadmap.problem, isNull);
      expect(roadmap.goals!.map((goal) => goal.text), ['Second']);
    });
  });

  group('the real backend client', () {
    final milestoneJson = {
      'id': 3,
      'done': true,
      'goneFromSource': false,
      'kind': 'plan',
      'goal': {'id': 1, 'text': 'Get into PA school'},
      'name': 'Finish your Year 2 Fall courses',
      'detail': '16 credit hours:\nBIOL 2112 Something',
      'dueDate': '2026-12-15',
      'when': 'By the end of Fall 2026',
      'sources': [
        {'url': bulletinPage, 'title': bulletinTitle, 'lastSeenAt': '2026-11-02T14:00:00.000Z'},
      ],
      'sourceNote': null,
      'calendarUrl': calendarLinkForTests,
    };
    final cardJson = {
      'id': 9,
      'kind': 'change',
      'status': 'not_now',
      'why': 'Because.',
      'note': null,
      'milestones': [milestoneJson],
      'removes': [
        {'id': 4, 'name': 'Old one'},
      ],
    };

    HttpBuddyBackend clientWith(http.Client client) =>
        HttpBuddyBackend(Uri.parse('http://backend.test'), deviceKey: 'the-key', onKeyRefused: () {}, client: client);

    test('loads the Roadmap with the device key', () async {
      final seen = <http.Request>[];
      final backend = clientWith(
        MockClient((request) async {
          seen.add(request);
          return http.Response(jsonEncode({'milestones': [milestoneJson]}), 200);
        }),
      );

      final [milestone] = await backend.loadRoadmap();

      expect(seen.single.url.path, '/roadmap');
      expect(seen.single.headers['authorization'], 'Bearer the-key');
      expect(milestone.id, 3);
      expect(milestone.done, isTrue);
      expect(milestone.goal?.text, 'Get into PA school');
      expect(milestone.badge, 'Goal: Get into PA school');
      expect(milestone.when, 'By the end of Fall 2026');
      expect(milestone.sources.single.url, bulletinPage);
      expect(milestone.calendarUrl, calendarLinkForTests);
    });

    test('sends the Student\'s tap on a card, and reads what became of it', () async {
      final seen = <http.Request>[];
      final backend = clientWith(
        MockClient((request) async {
          seen.add(request);
          return http.Response(jsonEncode({'card': cardJson, 'milestones': const []}), 200);
        }),
      );

      final answer = await backend.sayNotNowToRoadmapCard(9);
      await backend.acceptRoadmapCard(9);

      expect(seen.map((request) => (request.method, request.url.path)), [('POST', '/roadmap/cards/9/not-now'), ('POST', '/roadmap/cards/9/accept')]);
      expect(answer.card.status, RoadmapCardStatus.notNow);
      expect(answer.card.isFirst, isFalse);
      expect(answer.card.removes.single.name, 'Old one');
      expect(answer.card.milestones.single.name, 'Finish your Year 2 Fall courses');
    });

    test('sends a new Milestone, a change and an order as the backend wants them', () async {
      final seen = <http.Request>[];
      final backend = clientWith(
        MockClient((request) async {
          seen.add(request);
          return http.Response(jsonEncode({'milestones': const []}), 200);
        }),
      );

      await backend.addMilestone(name: 'A', dueDate: '2026-12-01', goalId: 1);
      await backend.setMilestoneDone(3, done: true);
      await backend.reorderMilestones([2, 1]);
      await backend.removeMilestone(3);

      expect(seen.map((request) => (request.method, request.url.path)), [
        ('POST', '/roadmap/milestones'),
        ('PATCH', '/roadmap/milestones/3'),
        ('PUT', '/roadmap/order'),
        ('DELETE', '/roadmap/milestones/3'),
      ]);
      expect(jsonDecode(seen[0].body), {'name': 'A', 'dueDate': '2026-12-01', 'goalId': 1});
      expect(jsonDecode(seen[1].body), {'done': true});
      expect(jsonDecode(seen[2].body), {'ids': [2, 1]});
    });

    test('sends and reads Goals', () async {
      final backend = clientWith(
        MockClient((request) async => switch (request.method) {
              'GET' => http.Response(jsonEncode({'goals': [{'id': 1, 'text': 'PA school'}]}), 200),
              'DELETE' => http.Response(jsonEncode({'goals': const [], 'milestones': const []}), 200),
              _ => http.Response(jsonEncode({'goal': {'id': 2, 'text': 'Abroad'}}), 200),
            }),
      );

      expect((await backend.loadGoals()).single.text, 'PA school');
      expect((await backend.addGoal('Abroad')).id, 2);
      expect((await backend.editGoal(2, 'Abroad')).text, 'Abroad');
      expect(await backend.removeGoal(1), isEmpty);
    });

    test('throws, and notices a refused key, when the backend says no', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        Uri.parse('http://backend.test'),
        deviceKey: 'the-key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('', 401)),
      );

      await expectLater(backend.loadRoadmap(), throwsA(isA<BackendException>()));
      expect(refused, isTrue);
    });

    test('reads a Roadmap card from the conversation and from a turn', () async {
      final backend = clientWith(
        MockClient((request) async {
          if (request.method == 'GET') {
            return http.Response(jsonEncode({'opening': 'Hi', 'messages': [{'type': 'roadmap_card', 'card': cardJson, 'sentAt': '2026-11-02T14:00:00.000Z'}]}), 200);
          }
          return http.Response('data: ${jsonEncode({'type': 'roadmap_card', 'card': cardJson})}\n\n', 200);
        }),
      );

      final items = await backend.loadHistory();
      final events = await backend.send('Hi').toList();

      expect((items.last as RoadmapCardItem).card.id, 9);
      expect((events.single as ReplyRoadmapCard).card.id, 9);
    });
  });
}
