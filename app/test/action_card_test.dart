import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/action_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const fingerprint = 'a1b2c3';

ActionCard formCard({
  int id = 7,
  String title = 'Submit a form on Canvas',
  String status = 'waiting',
  String statusText = 'Waiting for your tap.',
  bool canDecide = true,
  String? note = 'You can approve this until Tuesday.',
  String? outcome,
}) =>
    ActionCard(
      id: id,
      title: title,
      shows: const [
        CardLine(label: 'Page', value: 'https://canvas.test/forms/advising'),
        CardLine(label: 'Button Buddy presses', value: 'Send'),
        CardLine(label: 'subject', value: 'Meeting'),
      ],
      status: status,
      statusText: statusText,
      note: note,
      outcome: outcome,
      fingerprint: fingerprint,
      canDecide: canDecide,
    );

ActionCard doneCard({int id = 7}) => formCard(
      id: id,
      status: 'done',
      statusText: 'Done.',
      canDecide: false,
      note: null,
      outcome: 'Buddy submitted the form, and the site answered 303.',
    );

Future<void> showCard(WidgetTester tester, FakeBackend backend, ActionCard card) async {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  backend.history = [student('Send it'), ActionCardItem(card), buddy('Here is the card.')];
  await openUnlockedApp(tester, backend);
}

Future<void> tapButton(WidgetTester tester, String label) async {
  final button = find.widgetWithText(FilledButton, label).evaluate().isNotEmpty
      ? find.widgetWithText(FilledButton, label)
      : find.widgetWithText(OutlinedButton, label);
  await tester.ensureVisible(button);
  await tester.pumpAndSettle();
  await tester.tap(button);
  await tester.pump();
}

void main() {
  group('what the card shows', () {
    testWidgets('every line of exactly what will happen', (tester) async {
      await showCard(tester, FakeBackend(), formCard());

      expect(find.text('Submit a form on Canvas'), findsOneWidget);
      expect(find.text('Page'), findsOneWidget);
      expect(find.text('https://canvas.test/forms/advising'), findsOneWidget);
      expect(find.text('Button Buddy presses'), findsOneWidget);
      expect(find.text('Send'), findsOneWidget);
      expect(find.text('subject'), findsOneWidget);
      expect(find.text('Meeting'), findsOneWidget);
      expect(find.text('You can approve this until Tuesday.'), findsOneWidget);
    });

    testWidgets('Approve and Decline while it is waiting', (tester) async {
      await showCard(tester, FakeBackend(), formCard());

      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Decline'), findsOneWidget);
    });

    for (final (status, words) in [
      ('running', 'Buddy is doing this now.'),
      ('done', 'Done.'),
      ('not_run', "Buddy didn't do this."),
      ('unknown', "Buddy can't tell whether this happened."),
      ('declined', 'You declined this.'),
      ('expired', 'This card has expired.'),
      ('replaced', 'Buddy changed this, so this card no longer works.'),
    ]) {
      testWidgets('no buttons, and says so, when it is $status', (tester) async {
        await showCard(tester, FakeBackend(), formCard(status: status, statusText: words, canDecide: false, note: null));

        expect(find.text(words), findsOneWidget);
        expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
        expect(find.widgetWithText(OutlinedButton, 'Decline'), findsNothing);
      });
    }

    testWidgets('what happened in the end', (tester) async {
      await showCard(tester, FakeBackend(), doneCard());

      expect(find.text('Buddy submitted the form, and the site answered 303.'), findsOneWidget);
    });

    testWidgets('appears as soon as Buddy asks, during the reply', (tester) async {
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Send the form');

      backend.reply.add(ReplyActionCard(formCard()));
      await tester.pump();
      await tester.pump();

      expect(find.text('Submit a form on Canvas'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      await backend.reply.close();
    });
  });

  group('tapping Approve', () {
    testWidgets('sends exactly one approval, for that card, with what the card showed', (tester) async {
      final backend = FakeBackend()..cardAfterApprove = doneCard();
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      expect(backend.approvals, [(7, fingerprint)]);
      expect(backend.declines, isEmpty);
      expect(backend.sent, isEmpty);
    });

    testWidgets('sends one approval even if tapped twice before the answer comes', (tester) async {
      final backend = FakeBackend()
        ..cardAfterApprove = doneCard()
        ..holdApprove = true;
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      final button = find.widgetWithText(FilledButton, 'Approve');
      if (button.evaluate().isNotEmpty) await tester.tap(button, warnIfMissed: false);
      await tester.pump();

      expect(backend.approvals, [(7, fingerprint)]);
      backend.releaseApprove();
      await tester.pumpAndSettle();
      expect(backend.approvals, [(7, fingerprint)]);
    });

    testWidgets('can only approve that card, when there are two', (tester) async {
      final backend = FakeBackend()..cardAfterApprove = doneCard(id: 2);
      tester.view
        ..physicalSize = const Size(412, 2400)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      backend.history = [
        ActionCardItem(formCard(id: 1, title: 'First card')),
        ActionCardItem(formCard(id: 2, title: 'Second card')),
      ];
      await openUnlockedApp(tester, backend);

      await tester.tap(
        find.descendant(
          of: find.widgetWithText(ActionCardView, 'Second card'),
          matching: find.widgetWithText(FilledButton, 'Approve'),
        ),
      );
      await tester.pumpAndSettle();

      expect(backend.approvals, [(2, fingerprint)]);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(find.text('First card'), findsOneWidget);
    });

    testWidgets('shows what happened, with the buttons gone', (tester) async {
      final backend = FakeBackend()..cardAfterApprove = doneCard();
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      expect(find.text('Done.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
      expect(find.widgetWithText(OutlinedButton, 'Decline'), findsNothing);
    });

    testWidgets('shows the backend refusing the tap, and leaves the card as it says', (tester) async {
      final backend = FakeBackend()
        ..cardAfterApprove = formCard()
        ..approveRefusal = "You're in control of Buddy's Browser. Tap Done first, then Approve.";
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      expect(find.textContaining('Tap Done first'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
    });

    testWidgets('says the card has gone when it expired first', (tester) async {
      final backend = FakeBackend()
        ..cardAfterApprove = formCard(status: 'expired', statusText: 'This card has expired.', canDecide: false, note: null)
        ..approveRefusal = 'This card has expired.';
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      expect(find.text('This card has expired.'), findsWidgets);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
    });

    testWidgets('when the network drops, says trying again is safe, and lets the Student', (tester) async {
      final backend = FakeBackend()..approveError = Exception('no network');
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      expect(find.textContaining("won't do it twice"), findsOneWidget);

      backend
        ..approveError = null
        ..cardAfterApprove = doneCard();
      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      expect(backend.approvals, [(7, fingerprint), (7, fingerprint)]);
      expect(find.text('Done.'), findsOneWidget);
    });

    testWidgets('lets the Student check again when a step is still running', (tester) async {
      final backend = FakeBackend()..cardWhenChecked = doneCard();
      await showCard(
        tester,
        backend,
        formCard(status: 'running', statusText: 'Buddy is doing this now.', canDecide: false, note: null),
      );

      await tapButton(tester, 'Check again');
      await tester.pumpAndSettle();

      expect(find.text('Done.'), findsOneWidget);
      expect(backend.approvals, isEmpty);
    });
  });

  group('tapping Decline', () {
    testWidgets('sends one decline for that card and no approval', (tester) async {
      final backend = FakeBackend()
        ..cardAfterDecline = formCard(status: 'declined', statusText: 'You declined this.', canDecide: false, note: null);
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Decline');
      await tester.pumpAndSettle();

      expect(backend.declines, [7]);
      expect(backend.approvals, isEmpty);
      expect(find.text('You declined this.'), findsOneWidget);
    });

    testWidgets('says so if the backend cannot be reached', (tester) async {
      final backend = FakeBackend()..declineError = Exception('no network');
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Decline');
      await tester.pumpAndSettle();

      expect(find.textContaining("couldn't reach Buddy"), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
    });
  });

  group('typing in the chat', () {
    testWidgets('sends a message and never an approval', (tester) async {
      final backend = FakeBackend();
      await showCard(tester, backend, formCard());

      await sendMessage(tester, 'yes');

      expect(backend.sent, ['yes']);
      expect(backend.approvals, isEmpty);
      await backend.reply.close();
    });
  });

  group('accessibility', () {
    testWidgets('a screen reader hears the whole card as one item, with each line', (tester) async {
      final handle = tester.ensureSemantics();
      await showCard(tester, FakeBackend(), formCard());

      expect(
        find.bySemanticsLabel(
          RegExp(r'^Action card: Submit a form on Canvas\.\n.*Page: https://canvas\.test/forms/advising\n.*subject: Meeting', dotAll: true),
        ),
        findsOneWidget,
      );
      handle.dispose();
    });

    testWidgets('a screen reader hears which card each button is for', (tester) async {
      final handle = tester.ensureSemantics();
      await showCard(tester, FakeBackend(), formCard());

      expect(find.bySemanticsLabel('Approve: Submit a form on Canvas'), findsOneWidget);
      expect(find.bySemanticsLabel('Decline: Submit a form on Canvas'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('a card that just appeared is read out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, 'Send the form');

      backend.reply.add(ReplyActionCard(formCard()));
      await tester.pump();
      await tester.pump();

      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('^Action card: ')));
      expect(node.flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
      await backend.reply.close();
    });

    testWidgets('a card loaded from history is not read out', (tester) async {
      final handle = tester.ensureSemantics();
      await showCard(tester, FakeBackend(), formCard());

      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('^Action card: ')));
      expect(node.flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('what became of a tap is read out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..cardAfterApprove = doneCard();
      await showCard(tester, backend, formCard());

      await tapButton(tester, 'Approve');
      await tester.pumpAndSettle();

      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('^Done')));
      expect(node.flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('meets the guidelines for tap targets, labels and contrast', (tester) async {
      final handle = tester.ensureSemantics();
      await showCard(tester, FakeBackend(), formCard());

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('meets them with a step still running too', (tester) async {
      final handle = tester.ensureSemantics();
      await showCard(
        tester,
        FakeBackend(),
        formCard(status: 'running', statusText: 'Buddy is doing this now.', canDecide: false, note: null),
      );

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('fits a small phone with text at twice the size', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      final backend = FakeBackend()
        ..history = [
          student('Send it'),
          ActionCardItem(
            ActionCard(
              id: 7,
              title: 'Submit a form on Canvas',
              shows: const [
                CardLine(label: 'A very long label that goes on for a while', value: 'https://canvas.test/an/address/that/is/very/long/and/has/nowhere/to/break'),
              ],
              status: 'waiting',
              statusText: 'Waiting for your tap.',
              note: 'You can approve this until Tuesday, November 3, 2026 at 9:00 AM.',
              fingerprint: fingerprint,
              canDecide: true,
            ),
          ),
        ];
      await openUnlockedApp(tester, backend);

      expect(tester.takeException(), isNull);
      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Approve'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('talking to the backend', () {
    Map<String, dynamic> json(Map<String, dynamic> overrides) => {
          'id': 7,
          'kind': 'submit_form',
          'title': 'Submit a form on Canvas',
          'shows': [
            {'label': 'subject', 'value': 'Meeting'},
          ],
          'status': 'waiting',
          'statusText': 'Waiting for your tap.',
          'note': 'Until Tuesday.',
          'outcome': null,
          'fingerprint': fingerprint,
          'expiresAt': '2026-11-03T14:00:00.000Z',
          'canDecide': true,
          ...overrides,
        };

    HttpBuddyBackend backendAnswering(Future<http.Response> Function(http.Request) answer) => HttpBuddyBackend(
          Uri.parse('https://laptop.test'),
          deviceKey: 'key',
          onKeyRefused: () {},
          client: MockClient(answer),
        );

    test('Approve goes to that card, with the key and what the card showed', () async {
      late http.Request seen;
      final backend = backendAnswering((request) async {
        seen = request;
        return http.Response(jsonEncode({'card': json({'status': 'done', 'canDecide': false})}), 200);
      });

      final answer = await backend.approveActionCard(7, fingerprint);

      expect(seen.method, 'POST');
      expect(seen.url.path, '/action-cards/7/approve');
      expect(seen.headers['authorization'], 'Bearer key');
      expect(jsonDecode(seen.body), {'fingerprint': fingerprint});
      expect(answer.card.status, 'done');
      expect(answer.card.canDecide, isFalse);
      expect(answer.refusal, isNull);
    });

    test('A refused tap comes back with why, and the card as it is', () async {
      final backend = backendAnswering(
        (request) async => http.Response(
          jsonEncode({'error': 'Tap Done first.', 'card': json({})}),
          409,
        ),
      );

      final answer = await backend.approveActionCard(7, fingerprint);

      expect(answer.refusal, 'Tap Done first.');
      expect(answer.card.canDecide, isTrue);
    });

    test('Anything else is an error, so that the app never thinks it worked', () async {
      final backend = backendAnswering((request) async => http.Response('', 500));

      await expectLater(backend.approveActionCard(7, fingerprint), throwsA(isA<BackendException>()));
    });

    test('A refused key is noticed', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        Uri.parse('https://laptop.test'),
        deviceKey: 'key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('', 401)),
      );

      await expectLater(backend.declineActionCard(7), throwsA(isA<BackendException>()));
      expect(refused, isTrue);
    });

    test('Decline and checking go to that card', () async {
      final paths = <String>[];
      final backend = backendAnswering((request) async {
        paths.add('${request.method} ${request.url.path}');
        return http.Response(jsonEncode({'card': json({})}), 200);
      });

      await backend.declineActionCard(7);
      await backend.loadActionCard(7);

      expect(paths, ['POST /action-cards/7/decline', 'GET /action-cards/7']);
    });

    test('A card arrives during a reply', () async {
      final backend = backendAnswering(
        (request) async => http.Response('data: ${jsonEncode({'type': 'action_card', 'card': json({})})}\n\n', 200),
      );

      final events = await backend.send('Send it').toList();

      final event = events.single as ReplyActionCard;
      expect(event.card.title, 'Submit a form on Canvas');
      expect(event.card.fingerprint, fingerprint);
    });

    test('A card comes back with the conversation', () async {
      final card = json({});
      final backend = backendAnswering(
        (request) async => http.Response(
          jsonEncode({
            'messages': [
              {'type': 'action_card', 'card': card, 'sentAt': '2026-11-02T14:00:00.000Z'},
            ],
          }),
          200,
        ),
      );

      final items = await backend.loadHistory();

      final item = items.single as ActionCardItem;
      expect(item.card.title, 'Submit a form on Canvas');
      expect(item.card.shows.single.value, 'Meeting');
      expect(item.card.fingerprint, fingerprint);
    });
  });
}
