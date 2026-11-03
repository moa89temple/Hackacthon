import 'dart:async';
import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/tasks/task_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/fake_briefings.dart';
import 'support/test_app.dart';

const title = 'Find paid summer research programs';
const found = 'Two programs fit you.';
const dollar = 1000000000;

Task working({int id = 3, List<String> steps = const ['Searched the web.']}) =>
    Task(id: id, title: title, state: 'working', stateText: 'Buddy is working on this.', steps: steps, canCancel: true);

Task done({int id = 3, List<TaskSource> sources = const []}) =>
    Task(id: id, title: title, state: 'done', stateText: 'Done.', result: found, sources: sources, spentNanodollars: dollar ~/ 5);

Task askingToSpend({int id = 3}) => Task(
      id: id,
      title: title,
      state: 'needs_student',
      stateText: 'Buddy needs you before it can go on.',
      askingToSpend: true,
      spentNanodollars: 60 * 10000000,
      canCancel: true,
    );

Task waitingForCard({int id = 3}) => Task(
      id: id,
      title: title,
      state: 'needs_student',
      stateText: 'Buddy needs you before it can go on.',
      needs: const ['Approve or Decline the Action card at the end of your conversation: Send a form'],
      canCancel: true,
    );

Task failed({int id = 3}) => Task(id: id, title: title, state: 'failed', stateText: "Buddy couldn't finish this.", problem: 'Something went wrong partway, so Buddy stopped.');

Future<void> openToday(WidgetTester tester, FakeBackend backend) async {
  await openUnlockedApp(tester, backend);
  await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Today')));
  await settleApp(tester);
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
  group('a Task card in the conversation', () {
    testWidgets('appears as soon as Buddy starts the Task, with its progress and a Cancel button', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);

      await sendMessage(tester, 'Find me programs');
      backend.reply.add(ReplyTaskCard(working()));
      await settleApp(tester);

      expect(find.text(title), findsOneWidget);
      expect(find.text('Buddy is working on this.'), findsOneWidget);
      expect(find.text('Searched the web.'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsOneWidget);
      await backend.reply.close();
    });

    testWidgets('comes back with the conversation', (tester) async {
      final backend = FakeBackend(history: [student('Find me programs'), TaskCardItem(done())]);
      await openUnlockedApp(tester, backend);

      expect(find.text(found), findsOneWidget);
    });

    testWidgets('follows each change as the backend sends it', (tester) async {
      final backend = FakeBackend(history: [student('Find me programs'), TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);
      expect(find.text('Searched the web.'), findsOneWidget);

      backend.taskChanged(working(steps: const ['Searched the web.', 'Read a page on www.nih.gov.']));
      await settleApp(tester);
      expect(find.text('Read a page on www.nih.gov.'), findsOneWidget);

      backend.taskChanged(done());
      await settleApp(tester);
      expect(find.text('Done.'), findsOneWidget);
      expect(find.text(found), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsNothing);
    });

    testWidgets('sends one cancel for that Task, whatever the Student taps', (tester) async {
      final backend = FakeBackend(history: [TaskCardItem(working())])..tasks = [working()];
      backend.holdTaskTap = Completer<void>();
      backend.taskAfterTap = Task(id: 3, title: title, state: 'cancelled', stateText: 'You cancelled this.');
      await openUnlockedApp(tester, backend);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
      await tester.pump();
      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'), warnIfMissed: false);
      await tester.pump();
      backend.holdTaskTap!.complete();
      await settleApp(tester);

      expect(backend.cancelled, [3]);
      expect(find.text('You cancelled this.'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Cancel'), findsNothing);
    });

    testWidgets('says so when a tap can\'t reach the backend, and the Task stays as it was', (tester) async {
      final backend = FakeBackend(history: [TaskCardItem(working())])..tasks = [working()];
      backend.taskTapError = const BackendException('No');
      await openUnlockedApp(tester, backend);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
      await settleApp(tester);

      expect(find.textContaining("couldn't reach Buddy"), findsOneWidget);
      expect(find.text('Buddy is working on this.'), findsOneWidget);
    });

    testWidgets('says why when a Task failed', (tester) async {
      final backend = FakeBackend(history: [TaskCardItem(failed())]);
      await openUnlockedApp(tester, backend);

      expect(find.text('Something went wrong partway, so Buddy stopped.'), findsOneWidget);
    });

    testWidgets('opens a Source the Task looked at', (tester) async {
      final opened = <Uri>[];
      final backend = FakeBackend(history: [TaskCardItem(done(sources: const [TaskSource(title: 'NIH summer', url: 'https://www.nih.gov/summer')]))]);
      await openUnlockedApp(tester, backend, openPhone: (address) async {
        opened.add(address);
        return true;
      });

      await tester.tap(find.text('Buddy looked at: NIH summer'));
      await settleApp(tester);

      expect(opened, [Uri.parse('https://www.nih.gov/summer')]);
    });
  });

  group('the \$1 pause', () {
    testWidgets('asks on the card, and Keep going is the only thing that lets it go on', (tester) async {
      final backend = FakeBackend(history: [TaskCardItem(askingToSpend())])..tasks = [askingToSpend()];
      backend.taskAfterTap = working();
      await openUnlockedApp(tester, backend);

      expect(find.textContaining(r'has cost $0.60 so far'), findsOneWidget);
      expect(find.textContaining(r'past $1.00'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Keep going'));
      await settleApp(tester);

      expect(backend.keptGoing, [3]);
      expect(find.text('Buddy is working on this.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Keep going'), findsNothing);
    });

    testWidgets('can be answered with Cancel instead', (tester) async {
      final backend = FakeBackend(history: [TaskCardItem(askingToSpend())])..tasks = [askingToSpend()];
      await openUnlockedApp(tester, backend);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
      await settleApp(tester);

      expect(backend.cancelled, [3]);
      expect(backend.keptGoing, isEmpty);
    });
  });

  group('what a Task leaves in the conversation', () {
    testWidgets('comes in when the Task reaches the Student, with no message from them', (tester) async {
      final backend = FakeBackend(history: [student('Find me programs'), TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);

      backend.history = [
        student('Find me programs'),
        const ReadPermissionCardItem('canvas'),
        TaskCardItem(waitingForCard()),
        ActionCardItem(const ActionCard(id: 9, title: 'Send a form', shows: [], status: 'waiting', statusText: 'Waiting for your tap.', fingerprint: 'f', canDecide: true)),
      ];
      backend.taskChanged(waitingForCard());
      await settleApp(tester);

      expect(find.text('Send a form'), findsOneWidget);
      expect(find.textContaining('Approve or Decline the Action card'), findsOneWidget);
      expect(find.text('A Task needs you.'), findsOneWidget);
    });

    testWidgets('comes in too when the app catches up, having missed the change on the stream', (tester) async {
      final backend = FakeBackend(history: [student('Find me programs'), TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);

      backend.tasks = [waitingForCard()];
      backend.history = [
        student('Find me programs'),
        TaskCardItem(waitingForCard()),
        ActionCardItem(const ActionCard(id: 9, title: 'Send a form', shows: [], status: 'waiting', statusText: 'Waiting for your tap.', fingerprint: 'f', canDecide: true)),
      ];
      await comeBack(tester);

      expect(find.text('Send a form'), findsOneWidget);
    });

    testWidgets('says so in a message that goes away by itself, so that it doesn\'t stay over the box to write in', (tester) async {
      final backend = FakeBackend(history: [TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);

      backend.taskChanged(done());
      await settleApp(tester);
      expect(find.text('A Task is done.'), findsOneWidget);

      // Its time starts once it has finished sliding in.
      await tester.pump(const Duration(seconds: 1));
      await tester.pump(const Duration(seconds: 5));
      await tester.pumpAndSettle();
      expect(find.text('A Task is done.'), findsNothing);
    });

    testWidgets('waits for a reply being written, then comes in', (tester) async {
      final backend = FakeBackend(history: [student('Find me programs'), TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Hello');
      final loadsBefore = backend.historyLoads;

      backend.taskChanged(done());
      await settleApp(tester);
      expect(backend.historyLoads, loadsBefore);

      backend.history = [student('Find me programs'), buddy('Hi.'), TaskCardItem(done())];
      backend.reply.add(ReplyDone(buddy('Hi.')));
      await backend.reply.close();
      await settleApp(tester);

      expect(backend.historyLoads, loadsBefore + 1);
    });
  });

  group('the Today tab', () {
    testWidgets('shows what the backend says belongs there, newest first', (tester) async {
      final backend = FakeBackend()
        ..tasks = [
          done(id: 1),
          working(id: 2),
          Task(id: 3, title: 'An old one', state: 'done', stateText: 'Done.', onToday: false),
        ];
      await openToday(tester, backend);

      expect(find.text('Tasks'), findsOneWidget);
      expect(find.text(found), findsOneWidget);
      expect(find.text('Buddy is working on this.'), findsOneWidget);
      expect(find.text('An old one'), findsNothing);
      expect(tester.getTopLeft(find.text('Buddy is working on this.')).dy, lessThan(tester.getTopLeft(find.text(found)).dy));
    });

    testWidgets('shows no heading with no Tasks', (tester) async {
      await openToday(tester, FakeBackend());

      expect(find.text('Tasks'), findsNothing);
    });

    testWidgets('can cancel from there too', (tester) async {
      final backend = FakeBackend()..tasks = [working()];
      await openToday(tester, backend);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Cancel'));
      await settleApp(tester);

      expect(backend.cancelled, [3]);
    });
  });

  group('a tapped notification', () {
    testWidgets('opens the Task it\'s about while Buddy is running', (tester) async {
      final phone = FakePhoneNotifications();
      final backend = FakeBackend()..tasks = [done()];
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('You')));
      await settleApp(tester);

      phone.tapTaskNotification(3);
      await tester.pumpAndSettle();

      expect(find.text('Your Task'), findsOneWidget);
      expect(find.text(found), findsOneWidget);
    });

    testWidgets('opens the Task when it was what opened the app', (tester) async {
      final phone = FakePhoneNotifications()..taskOpenedAtStart = 3;
      final backend = FakeBackend()..tasks = [done()];
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await tester.pumpAndSettle();

      expect(find.text('Your Task'), findsOneWidget);
      expect(find.text(found), findsOneWidget);
    });

    testWidgets('says so when that Task can\'t be found', (tester) async {
      final phone = FakePhoneNotifications();
      await openUnlockedApp(tester, FakeBackend(), phoneNotifications: phone);

      phone.tapTaskNotification(99);
      await tester.pumpAndSettle();

      expect(find.text("Buddy can't find that Task."), findsOneWidget);
    });
  });

  group('screen readers and larger text', () {
    testWidgets('read the whole card as one item, with the buttons their own stops', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend(history: [TaskCardItem(askingToSpend())])..tasks = [askingToSpend()];
      await openUnlockedApp(tester, backend);

      final card = tester.getSemantics(find.bySemanticsLabel(RegExp('^Task: $title')));
      expect(card.label, contains('has cost 60 cents so far'));
      expect(card.label, contains('past 1 dollar'));
      expect(find.bySemanticsLabel('Keep going, and let this Task spend up to 1 dollar more'), findsOneWidget);
      expect(find.bySemanticsLabel('Cancel the Task: $title'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('announce a new card, and not one loaded with the conversation', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend(history: [TaskCardItem(done(id: 1))]);
      await openUnlockedApp(tester, backend);
      final loaded = tester.getSemantics(find.bySemanticsLabel(RegExp('^Task: $title')));
      expect(loaded.flagsCollection.isLiveRegion, isFalse);

      await sendMessage(tester, 'Find me programs');
      backend.reply.add(ReplyTaskCard(working(id: 2)));
      await settleApp(tester);

      final fresh = tester.getSemantics(find.bySemanticsLabel(RegExp('^Task: $title\\.\\nBuddy is working')));
      expect(fresh.flagsCollection.isLiveRegion, isTrue);
      await backend.reply.close();
      handle.dispose();
    });

    testWidgets('read out a change of state', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend(history: [TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);

      final before = tester.getSemantics(find.bySemanticsLabel(RegExp('^Task: $title')));
      expect(before.flagsCollection.isLiveRegion, isFalse);

      backend.taskChanged(done());
      await settleApp(tester);

      final after = tester.getSemantics(find.bySemanticsLabel(RegExp('^Task: $title\\.\\nDone\\.')));
      expect(after.flagsCollection.isLiveRegion, isTrue);
      expect(after.label, contains(found));
      handle.dispose();
    });

    testWidgets('keep each step to its own stop, so that progress isn\'t read out over everything else', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend(history: [TaskCardItem(working())])..tasks = [working()];
      await openUnlockedApp(tester, backend);

      backend.taskChanged(working(steps: const ['Searched the web.', 'Read a page on www.nih.gov.']));
      await settleApp(tester);

      final card = tester.getSemantics(find.bySemanticsLabel(RegExp('^Task: $title')));
      expect(card.flagsCollection.isLiveRegion, isFalse);
      expect(card.label, isNot(contains('Read a page')));
      expect(find.bySemanticsLabel('Read a page on www.nih.gov.'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('fit on a small phone with large text', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final backend = FakeBackend(history: [TaskCardItem(askingToSpend())])..tasks = [askingToSpend()];
      await openUnlockedApp(tester, backend);

      expect(tester.takeException(), isNull);
      expect(find.widgetWithText(FilledButton, 'Keep going'), findsOneWidget);
    });

    testWidgets('fit on the Today tab and the Task\'s screen too', (tester) async {
      useSmallPhoneWithLargeText(tester);
      final phone = FakePhoneNotifications();
      final backend = FakeBackend()..tasks = [done(sources: const [TaskSource(title: 'A page with quite a long title on it', url: 'https://example.edu/')]), waitingForCard(id: 4)];
      await openUnlockedApp(tester, backend, phoneNotifications: phone);
      await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Today')));
      await settleApp(tester);
      expect(tester.takeException(), isNull);

      phone.tapTaskNotification(4);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      // The list builds only what's near the screen, and with text this large the button is further down.
      await tester.dragUntilVisible(find.text('Go to your conversation'), find.byType(ListView).last, const Offset(0, -200));
      expect(find.text('Go to your conversation'), findsOneWidget);
    });
  });

  group('talking to the real backend', () {
    HttpBuddyBackend backendThatAnswers(http.Response Function(http.Request request) answer) =>
        HttpBuddyBackend(Uri.parse('https://laptop.test'), deviceKey: 'key', onKeyRefused: () {}, client: MockClient((request) async => answer(request)));

    final taskJson = {
      'id': 3,
      'title': title,
      'state': 'working',
      'stateText': 'Buddy is working on this.',
      'steps': ['Searched the web.'],
      'needs': <String>[],
      'askingToSpend': false,
      'result': null,
      'problem': null,
      'sources': [
        {'title': 'NIH', 'url': 'https://www.nih.gov/'},
      ],
      'spentNanodollars': 5,
      'allowanceNanodollars': dollar,
      'canCancel': true,
      'onToday': true,
    };

    test('reads a Task as the backend writes it, in the list and from the stream', () async {
      final backend = backendThatAnswers((_) => http.Response(jsonEncode({'tasks': [taskJson]}), 200));

      final [task] = await backend.loadTasks();

      expect(task.title, title);
      expect(task.steps, ['Searched the web.']);
      expect(task.sources.single.url, 'https://www.nih.gov/');
      expect(task.spentNanodollars, 5);
    });

    test('hears each change on the stream, and ignores the keep-alive lines', () async {
      final client = MockClient.streaming((request, _) async {
        final body = ': still here\n\ndata: ${jsonEncode({'type': 'task_update', 'task': taskJson})}\n\n';
        return http.StreamedResponse(Stream.value(utf8.encode(body)), 200);
      });
      final backend = HttpBuddyBackend(Uri.parse('https://laptop.test'), deviceKey: 'key', onKeyRefused: () {}, client: client);

      final heard = await backend.watchTasks().toList();

      expect(heard.single.id, 3);
    });

    test('cancels and keeps going with a POST for that Task, with the phone\'s key', () async {
      final requests = <http.Request>[];
      final backend = backendThatAnswers((request) {
        requests.add(request);
        return http.Response(jsonEncode({'task': taskJson}), 200);
      });

      await backend.cancelTask(3);
      await backend.keepTaskGoing(3);

      expect(requests.map((request) => '${request.method} ${request.url.path}'), ['POST /tasks/3/cancel', 'POST /tasks/3/keep-going']);
      expect(requests.first.headers.values, contains(contains('key')));
    });
  });
}
