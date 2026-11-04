import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/outlook.dart';
import 'package:buddy/sending/sending_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const ownAddress = 'student@temple.test';
const words = 'Hello,\n\nCan you help with my hold?\n\nDrafted with help from Buddy, an AI assistant';

GuidebookItem advising({String? email = 'advising@temple.test'}) => GuidebookItem(
      id: 7,
      name: 'Academic Advising Office',
      summary: 'Helps with holds.',
      email: email,
      sources: [GuidebookSource(url: 'https://advising.temple.edu/contact', title: 'Contact', lastSeenAt: DateTime.utc(2026, 11, 2, 14))],
    );

Draft aDraft({GuidebookItem? contact}) => Draft(id: 3, contact: contact, why: contact == null ? null : 'They help.', subject: 'Hold', body: words);

ActionCard sendCard({String status = 'waiting', String statusText = 'Waiting for your tap.', bool canDecide = true, String? outcome}) => ActionCard(
      id: 9,
      title: 'Send a practice email to yourself',
      shows: const [
        CardLine(label: 'Practice mode', value: 'This goes to you, not to Academic Advising Office.'),
        CardLine(label: 'To', value: ownAddress),
        CardLine(label: 'In Live, this would go to', value: 'Academic Advising Office <advising@temple.test>'),
        CardLine(label: 'Subject', value: 'Hold'),
        CardLine(label: 'Message', value: words),
      ],
      status: status,
      statusText: statusText,
      note: canDecide ? 'You can approve this until Tuesday.' : null,
      outcome: outcome,
      fingerprint: 'abc',
      canDecide: canDecide,
    );

Future<void> showDraft(WidgetTester tester, FakeBackend backend, {GuidebookItem? contact, Size size = const Size(412, 1600)}) async {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  backend.history = [student('Help?'), DraftCardItem(aDraft(contact: contact)), buddy('Here you go.')];
  await openUnlockedApp(tester, backend);
}

Future<void> tapThrough(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

/// The You tab, then the row for sending. On a small phone the row has to be scrolled to first.
Future<void> goToSendingScreen(WidgetTester tester) async {
  await goToTab(tester, 'You');
  await settleApp(tester);
  await tester.scrollUntilVisible(find.text('Email Buddy sends'), 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
  await tester.tap(find.text('Email Buddy sends'));
  await tester.pumpAndSettle();
}

Future<void> openSending(WidgetTester tester, FakeBackend backend, {Size size = const Size(412, 2400)}) async {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await openUnlockedApp(tester, backend);
  await goToSendingScreen(tester);
}

Finder get _switchToLive => find.widgetWithText(OutlinedButton, 'Switch to Live');
Finder get _backToPractice => find.widgetWithText(OutlinedButton, 'Back to Practice mode');
Finder get _addressField => find.widgetWithText(TextField, 'Your TUmail address');
Finder get _saveAddress => find.widgetWithText(FilledButton, 'Save your address');
Finder inDialog(String text) => find.descendant(of: find.byType(AlertDialog), matching: find.text(text));

void main() {
  group('Buddy sends it on a Draft card', () {
    testWidgets('is there when Buddy has an address for the Contact', (tester) async {
      await showDraft(tester, FakeBackend(), contact: advising());
      expect(find.text('Buddy sends it'), findsOneWidget);
    });

    testWidgets("isn't there when Buddy has no address, or the Contact has gone", (tester) async {
      await showDraft(tester, FakeBackend(), contact: advising(email: null));
      expect(find.text('Buddy sends it'), findsNothing);
    });

    testWidgets("isn't there for a Draft whose Contact has gone", (tester) async {
      await showDraft(tester, FakeBackend());
      expect(find.text('Buddy sends it'), findsNothing);
    });

    testWidgets('says what the button does, and that nothing goes without Approve', (tester) async {
      await showDraft(tester, FakeBackend(), contact: advising());
      expect(find.textContaining('nothing goes until you tap Approve'), findsOneWidget);
    });

    testWidgets('shows the Action card with the exact recipient, subject and message, and approves nothing', (tester) async {
      final backend = FakeBackend()..cardToSend = sendCard();
      await showDraft(tester, backend, contact: advising());

      await tapThrough(tester, find.text('Buddy sends it'));

      expect(backend.sendCardsAskedFor, [3]);
      expect(backend.approvals, isEmpty);
      expect(find.text('Send a practice email to yourself'), findsOneWidget);
      expect(find.text(ownAddress), findsOneWidget);
      expect(find.text('Academic Advising Office <advising@temple.test>'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
    });

    testWidgets('only Approve sends what the card showed', (tester) async {
      final backend = FakeBackend()
        ..cardToSend = sendCard()
        ..cardAfterApprove = sendCard(status: 'done', statusText: 'Done.', canDecide: false, outcome: 'Buddy sent this.');
      await showDraft(tester, backend, contact: advising());
      await tapThrough(tester, find.text('Buddy sends it'));

      await tapThrough(tester, find.widgetWithText(FilledButton, 'Approve'));

      expect(backend.approvals, [(9, 'abc')]);
      expect(find.text('Buddy sent this.'), findsOneWidget);
    });

    testWidgets('a second tap shows the same card, not another one', (tester) async {
      final backend = FakeBackend()..cardToSend = sendCard();
      await showDraft(tester, backend, contact: advising());

      await tapThrough(tester, find.text('Buddy sends it'));
      await tapThrough(tester, find.text('Buddy sends it'));

      expect(find.text('Send a practice email to yourself'), findsOneWidget);
    });

    testWidgets("says why when Buddy won't make a card, such as with no address for the Student", (tester) async {
      final backend = FakeBackend()..sendCardRefusal = "Buddy doesn't know your address yet. Add it on the You tab.";
      await showDraft(tester, backend, contact: advising());

      await tapThrough(tester, find.text('Buddy sends it'));

      expect(find.text("Buddy doesn't know your address yet. Add it on the You tab."), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
    });

    testWidgets("says so when the backend can't be reached", (tester) async {
      final backend = FakeBackend()..sendCardError = http.ClientException('no route');
      await showDraft(tester, backend, contact: advising());

      await tapThrough(tester, find.text('Buddy sends it'));

      expect(find.textContaining("couldn't reach Buddy"), findsOneWidget);
    });

    testWidgets('an edit makes a waiting card show that it no longer works', (tester) async {
      final backend = FakeBackend()
        ..cardToSend = sendCard()
        ..cardWhenChecked = sendCard(status: 'invalid', statusText: 'This card no longer matches.', canDecide: false, outcome: 'You edited the Draft.');
      await showDraft(tester, backend, contact: advising());
      await tapThrough(tester, find.text('Buddy sends it'));

      await tapThrough(tester, find.text('Edit'));
      await tapThrough(tester, find.widgetWithText(FilledButton, 'Save'));

      expect(find.text('You edited the Draft.'), findsOneWidget);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsNothing);
    });
  });

  group('the row on the You tab', () {
    testWidgets('says which mode is on, and claims none until it has heard', (tester) async {
      final backend = FakeBackend()..sendingError = http.ClientException('no route');
      await openUnlockedApp(tester, backend);
      await goToTab(tester, 'You');
      await settleApp(tester);

      expect(find.text('Email Buddy sends'), findsOneWidget);
      expect(find.text('Practice mode'), findsNothing);
      expect(find.text('Live'), findsNothing);

      backend.sendingError = null;
      await goToTab(tester, 'You');
      await settleApp(tester);
      expect(find.text('Practice mode'), findsOneWidget);
      expect(find.text('Live'), findsNothing);

      backend.sending = const SendingSettings(isLive: true, ownAddress: ownAddress);
      await goToTab(tester, 'You');
      await settleApp(tester);
      expect(find.text('Live'), findsOneWidget);
      expect(find.text('Practice mode'), findsNothing);
    });
  });

  group('the screen for sending', () {
    testWidgets('starts in Practice mode, and says Buddy needs the address', (tester) async {
      await openSending(tester, FakeBackend());

      expect(find.text('Practice mode'), findsOneWidget);
      expect(find.textContaining('Practice mode is on'), findsOneWidget);
      expect(find.textContaining("doesn't know your TUmail address yet"), findsOneWidget);
      expect(_switchToLive, findsOneWidget);
    });

    testWidgets('saves the address and says where practice emails go', (tester) async {
      final backend = FakeBackend();
      await openSending(tester, backend);

      await tester.enterText(_addressField, ownAddress);
      await tapThrough(tester, _saveAddress);

      expect(backend.ownAddressesSaved, [ownAddress]);
      expect(find.textContaining('Practice emails go to $ownAddress'), findsOneWidget);
    });

    testWidgets('says why when the backend refuses the address', (tester) async {
      final backend = FakeBackend()..ownAddressRefusal = "That doesn't look like a temple.edu address.";
      await openSending(tester, backend);

      await tester.enterText(_addressField, 'someone@elsewhere.test');
      await tapThrough(tester, _saveAddress);

      expect(find.text("That doesn't look like a temple.edu address."), findsOneWidget);
      expect(backend.ownAddressesSaved, isEmpty);
    });

    testWidgets('going Live asks first, and staying in Practice changes nothing', (tester) async {
      final backend = FakeBackend();
      await openSending(tester, backend);

      await tapThrough(tester, _switchToLive);

      expect(find.textContaining("can't be taken back"), findsOneWidget);
      await tapThrough(tester, inDialog('Stay in Practice mode'));

      expect(backend.modesAskedFor, isEmpty);
      expect(find.textContaining('Practice mode is on'), findsOneWidget);
    });

    testWidgets('only that tap goes Live, and the screen then says so', (tester) async {
      final backend = FakeBackend();
      await openSending(tester, backend);

      await tapThrough(tester, _switchToLive);
      await tapThrough(tester, inDialog('Switch to Live'));

      expect(backend.modesAskedFor, ['live']);
      expect(find.textContaining('Live is on'), findsOneWidget);
      expect(_backToPractice, findsOneWidget);
    });

    testWidgets('going back to Practice needs no asking', (tester) async {
      final backend = FakeBackend()..sending = const SendingSettings(isLive: true, ownAddress: ownAddress);
      await openSending(tester, backend);

      await tapThrough(tester, _backToPractice);

      expect(backend.modesAskedFor, ['practice']);
      expect(find.textContaining('Practice mode is on'), findsOneWidget);
    });

    testWidgets('says so when a change fails, and stays as it was', (tester) async {
      final backend = FakeBackend()..sendingChangeError = http.ClientException('no route');
      await openSending(tester, backend);

      await tapThrough(tester, _switchToLive);
      await tapThrough(tester, inDialog('Switch to Live'));

      expect(find.textContaining("couldn't reach Buddy"), findsOneWidget);
      expect(find.textContaining('Practice mode is on'), findsOneWidget);
    });

    testWidgets("doesn't claim a mode when it can't load, and can try again", (tester) async {
      final backend = FakeBackend()..sendingError = http.ClientException('no route');
      await openSending(tester, backend);

      expect(find.textContaining('Practice mode is on'), findsNothing);
      expect(_switchToLive, findsNothing);

      backend.sendingError = null;
      await tapThrough(tester, find.bySemanticsLabel('Try loading sending again'));

      expect(find.textContaining('Practice mode is on'), findsOneWidget);
    });

    testWidgets('a change of mode makes a waiting card show that it no longer works', (tester) async {
      final backend = FakeBackend()
        ..cardToSend = sendCard()
        ..cardWhenChecked = sendCard(status: 'invalid', statusText: 'This card no longer matches.', canDecide: false, outcome: 'You switched to Live.');
      await showDraft(tester, backend, contact: advising());
      await tapThrough(tester, find.text('Buddy sends it'));
      await goToSendingScreen(tester);

      await tapThrough(tester, _switchToLive);
      await tapThrough(tester, inDialog('Switch to Live'));
      await tester.pageBack();
      await tester.pumpAndSettle();
      await goToTab(tester, 'Buddy');
      await settleApp(tester);

      expect(find.text('You switched to Live.'), findsOneWidget);
    });
  });

  group('with a screen reader', () {
    testWidgets('the Draft card names its new button for its Contact, and the card it makes is read out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..cardToSend = sendCard();
      await showDraft(tester, backend, contact: advising());

      expect(find.bySemanticsLabel('Buddy sends it: the Draft to Academic Advising Office'), findsOneWidget);
      await tapThrough(tester, find.text('Buddy sends it'));

      final node = tester.getSemantics(find.bySemanticsLabel(RegExp('^Action card: Send a practice email')));
      expect(node.flagsCollection.isLiveRegion, isTrue);
      expect(node.label, contains('To: $ownAddress'));
      expect(node.label, contains('In Live, this would go to'));
      handle.dispose();
    });

    testWidgets('the screen for sending meets the guidelines, with a heading and named controls', (tester) async {
      final handle = tester.ensureSemantics();
      await openSending(tester, FakeBackend());

      expect(tester.getSemantics(find.text('Email Buddy sends')).flagsCollection.isHeader, isTrue);
      expect(tester.getSemantics(_addressField).label, contains('Your TUmail address'));
      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('what becomes of a change is read out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..ownAddressRefusal = 'That address is no good.';
      await openSending(tester, backend);

      await tester.enterText(_addressField, 'x');
      await tapThrough(tester, _saveAddress);

      expect(tester.getSemantics(find.text('That address is no good.')).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });
  });

  group('with larger text', () {
    void useLargeText(WidgetTester tester) {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    }

    testWidgets('the new button and the card it makes fit at twice the size on a small phone', (tester) async {
      useLargeText(tester);
      final backend = FakeBackend()..cardToSend = sendCard();
      await showDraft(tester, backend, contact: advising(), size: const Size(320, 640));

      await tapThrough(tester, find.text('Buddy sends it'));
      expect(tester.takeException(), isNull);

      await tester.ensureVisible(find.widgetWithText(FilledButton, 'Approve'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });

    testWidgets('the screen for sending and the question about Live fit at twice the size on a small phone', (tester) async {
      useLargeText(tester);
      await openSending(tester, FakeBackend(), size: const Size(320, 640));

      await tester.scrollUntilVisible(_switchToLive, 200, scrollable: find.byType(Scrollable).first);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.tap(_switchToLive);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.ensureVisible(inDialog('Switch to Live'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('talking to the backend', () {
    final baseUrl = Uri.parse('http://backend.test');
    final cardJson = {
      'id': 9,
      'kind': 'send_email',
      'title': 'Send a practice email to yourself',
      'shows': [
        {'label': 'To', 'value': ownAddress},
      ],
      'status': 'waiting',
      'statusText': 'Waiting for your tap.',
      'note': null,
      'outcome': null,
      'fingerprint': 'abc',
      'expiresAt': '2026-11-03T14:00:00.000Z',
      'canDecide': true,
    };

    HttpBuddyBackend backendAnswering(int status, Object answer, List<http.Request> seen) => HttpBuddyBackend(
          baseUrl,
          deviceKey: 'key',
          onKeyRefused: () {},
          client: MockClient((request) async {
            seen.add(request);
            return http.Response(jsonEncode(answer), status, headers: {'content-type': 'application/json'});
          }),
        );

    test('loads the mode with the device key, and reads it as Practice unless it clearly says live', () async {
      final seen = <http.Request>[];
      final settings = await backendAnswering(200, {
        'sending': {'mode': 'something else', 'ownAddress': null},
      }, seen).loadSending();

      expect(seen.single.url.path, '/sending');
      expect(seen.single.headers['authorization'], 'Bearer key');
      expect(settings.isLive, isFalse);
    });

    test('switches with an empty request, which Claude has nothing to do with', () async {
      final seen = <http.Request>[];
      final settings = await backendAnswering(200, {
        'sending': {'mode': 'live', 'ownAddress': ownAddress},
      }, seen).switchToLive();

      expect(seen.single.method, 'POST');
      expect(seen.single.url.path, '/sending/live');
      expect(seen.single.headers.containsKey('content-type'), isFalse);
      expect(settings.isLive, isTrue);
      expect(settings.ownAddress, ownAddress);
    });

    test('goes back with its own request', () async {
      final seen = <http.Request>[];
      await backendAnswering(200, {
        'sending': {'mode': 'practice', 'ownAddress': null},
      }, seen).switchToPractice();

      expect(seen.single.url.path, '/sending/practice');
    });

    test('sends the address in the body', () async {
      final seen = <http.Request>[];
      await backendAnswering(200, {
        'sending': {'mode': 'practice', 'ownAddress': ownAddress},
      }, seen).saveOwnAddress(ownAddress);

      expect(seen.single.method, 'PUT');
      expect(seen.single.url.path, '/sending/own-address');
      expect(jsonDecode(seen.single.body), {'address': ownAddress});
    });

    test("reads the backend's words when it refuses an address", () async {
      expect(
        () => backendAnswering(400, {'error': 'No good.'}, []).saveOwnAddress('x'),
        throwsA(isA<SendingRefused>().having((refused) => refused.message, 'message', 'No good.')),
      );
    });

    test('asks for a card by the Draft alone, so that nothing else can be slipped in', () async {
      final seen = <http.Request>[];
      final card = await backendAnswering(200, {'card': cardJson}, seen).askForSendCard(3);

      expect(seen.single.method, 'POST');
      expect(seen.single.url.path, '/drafts/3/send-card');
      expect(seen.single.body, isEmpty);
      expect(card.id, 9);
      expect(card.fingerprint, 'abc');
    });

    test("reads the backend's words when it won't make a card", () async {
      expect(
        () => backendAnswering(409, {'error': 'Add your address.'}, []).askForSendCard(3),
        throwsA(isA<SendingRefused>().having((refused) => refused.message, 'message', 'Add your address.')),
      );
    });

    test('notices a refused key', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('{}', 401)),
      );

      await expectLater(backend.loadSending(), throwsA(isA<BackendException>()));
      expect(refused, isTrue);
    });
  });

  test('opening in Outlook is untouched by any of this', () {
    expect(outlookWebAddress(const OutlookEmail(subject: 'S', body: 'B')).path, '/mail/deeplink/compose');
  });
}
