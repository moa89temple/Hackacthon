import 'dart:convert';

import 'package:buddy/activity/activity_screen.dart';
import 'package:buddy/backend/buddy_backend.dart';
import 'package:buddy/chat/outlook.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const aiLine = 'Drafted with help from Buddy, an AI assistant';
const body = 'Hello,\n\nCan you help with my hold?\n\nThanks,\nMaria\n\n$aiLine';

GuidebookItem advising({String? email = 'advising@temple.test'}) => GuidebookItem(
      id: 7,
      name: 'Academic Advising Office',
      summary: 'Helps with holds.',
      email: email,
      sources: [
        GuidebookSource(
          url: 'https://advising.temple.edu/contact',
          title: 'Contact the Advisors',
          lastSeenAt: DateTime.utc(2026, 11, 2, 14),
        ),
      ],
    );

Draft aDraft({GuidebookItem? contact, String subject = 'Hold on my account', String words = body}) => Draft(
      id: 3,
      contact: contact,
      why: contact == null ? null : 'They help Students with holds.',
      subject: subject,
      body: words,
    );

final class Opened {
  final emails = <OutlookEmail>[];
  bool answer = true;

  Future<bool> call(OutlookEmail email) async {
    emails.add(email);
    return answer;
  }
}

Future<void> showDraft(
  WidgetTester tester,
  Draft draft, {
  FakeBackend? backend,
  DraftOpener openDraft = pretendToOpenDraft,
  Size size = const Size(412, 1400),
}) async {
  tester.view
    ..physicalSize = size
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await openUnlockedApp(
    tester,
    (backend ?? FakeBackend())..history = [student('Help?'), DraftCardItem(draft), buddy('Here you go.')],
    openDraft: openDraft,
  );
}

Future<void> tapThrough(WidgetTester tester, Finder target) async {
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

/// What the phone was asked to put on its clipboard.
List<String> watchClipboard(WidgetTester tester) {
  final copied = <String>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
    if (call.method == 'Clipboard.setData') copied.add((call.arguments as Map)['text'] as String);
    return null;
  });
  addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
  return copied;
}

Finder get _messageField => find.widgetWithText(TextField, 'Message');
Finder get _subjectField => find.widgetWithText(TextField, 'Subject');

/// A text button holding these words. A plain `byType` wouldn't match, because one with an icon is its own type.
Finder _textButton(String words) => find.ancestor(of: find.text(words), matching: find.byWidgetPredicate((widget) => widget is TextButton));

void main() {
  group('what the card shows', () {
    testWidgets('who it is to, why them, and all the words, ending with the AI line', (tester) async {
      await showDraft(tester, aDraft(contact: advising()));

      expect(find.text('Draft to Academic Advising Office'), findsOneWidget);
      expect(find.text('To: advising@temple.test'), findsOneWidget);
      expect(find.text('Why them: They help Students with holds.'), findsOneWidget);
      expect(find.text('Subject: Hold on my account'), findsOneWidget);
      expect(find.text(body), findsOneWidget);
    });

    testWidgets('has the three buttons', (tester) async {
      await showDraft(tester, aDraft(contact: advising()));

      expect(_textButton('Edit'), findsOneWidget);
      expect(find.widgetWithText(OutlinedButton, 'Open in Outlook'), findsOneWidget);
      expect(_textButton('Copy'), findsOneWidget);
    });

    testWidgets('offers the other route, of Buddy explaining the issue itself', (tester) async {
      await showDraft(tester, aDraft(contact: advising()));

      expect(find.text('Rather not write to anyone? Ask Buddy, and it will explain the issue itself.'), findsOneWidget);
    });

    testWidgets('says so when Buddy has no address for the Contact', (tester) async {
      await showDraft(tester, aDraft(contact: advising(email: null)));

      expect(find.textContaining('To:'), findsNothing);
      expect(find.textContaining("doesn't have an email address"), findsOneWidget);
    });

    testWidgets('keeps the Draft but not the Contact once the Contact has gone from the Guidebook', (tester) async {
      await showDraft(tester, aDraft());

      expect(find.text('Draft'), findsOneWidget);
      expect(find.textContaining('Academic Advising Office'), findsNothing);
      expect(find.textContaining('no longer shows who this was for'), findsOneWidget);
      expect(find.text(body), findsOneWidget);
    });

    testWidgets('loses the Contact as soon as the Student reports them', (tester) async {
      final item = advising();
      final backend = FakeBackend();
      tester.view
        ..physicalSize = const Size(412, 1400)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      backend.history = [student('Help?'), GuidebookCardItem(item), DraftCardItem(aDraft(contact: item))];
      await openUnlockedApp(tester, backend);

      await tapThrough(tester, find.text('Report'));
      await tester.tap(find.widgetWithText(TextButton, 'Report').last);
      await tester.pumpAndSettle();

      expect(find.text('Draft'), findsOneWidget);
      expect(find.textContaining('advising@temple.test'), findsNothing);
      expect(find.textContaining('Why them'), findsNothing);
    });

    testWidgets('appears during a reply and is read out', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend();
      tester.view
        ..physicalSize = const Size(412, 1400)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await openUnlockedApp(tester, backend);

      await sendMessage(tester, 'I have a hold.');
      backend.reply.add(ReplyDraftCard(aDraft(contact: advising())));
      await tester.pump();

      expect(find.text('Draft to Academic Advising Office'), findsOneWidget);
      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Draft to Academic'))).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('is not read out when it loads from history', (tester) async {
      final handle = tester.ensureSemantics();
      await showDraft(tester, aDraft(contact: advising()));

      expect(tester.getSemantics(find.bySemanticsLabel(RegExp('^Draft to Academic'))).flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });
  });

  group('Open in Outlook', () {
    testWidgets('opens a new email with the Draft filled in, and tells the backend nothing', (tester) async {
      final opened = Opened();
      final backend = FakeBackend();
      watchClipboard(tester);
      await showDraft(tester, aDraft(contact: advising()), backend: backend, openDraft: opened.call);

      await tapThrough(tester, find.text('Open in Outlook'));

      final email = opened.emails.single;
      expect(email.to, 'advising@temple.test');
      expect(email.subject, 'Hold on my account');
      expect(email.body, body);
      expect(backend.draftEdits, isEmpty);
      expect(backend.sent, isEmpty);
    });

    testWidgets('leaves the address out when Buddy has none', (tester) async {
      final opened = Opened();
      watchClipboard(tester);
      await showDraft(tester, aDraft(), openDraft: opened.call);

      await tapThrough(tester, find.text('Open in Outlook'));

      expect(opened.emails.single.to, isNull);
    });

    testWidgets('copies the message too, in case Outlook does not fill it in, and says so', (tester) async {
      final copied = watchClipboard(tester);
      await showDraft(tester, aDraft(contact: advising()));

      await tapThrough(tester, find.text('Open in Outlook'));

      expect(copied, [body]);
      expect(find.textContaining('Buddy also copied the message'), findsOneWidget);
      expect(find.textContaining('your TUmail'), findsOneWidget);
    });

    testWidgets('says so when the phone could not open it, and the message is still copied', (tester) async {
      final handle = tester.ensureSemantics();
      final copied = watchClipboard(tester);
      final opened = Opened()..answer = false;
      await showDraft(tester, aDraft(contact: advising()), openDraft: opened.call);

      await tapThrough(tester, find.text('Open in Outlook'));

      expect(copied, [body]);
      final problem = find.textContaining("couldn't open Outlook");
      expect(problem, findsOneWidget);
      expect(tester.getSemantics(problem).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('still opens if the clipboard fails, without promising a copy', (tester) async {
      final opened = Opened();
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') throw PlatformException(code: 'no');
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await showDraft(tester, aDraft(contact: advising()), openDraft: opened.call);

      await tapThrough(tester, find.text('Open in Outlook'));

      expect(opened.emails, hasLength(1));
      expect(find.textContaining('copied'), findsNothing);
    });

    testWidgets('uses the words as the Student left them', (tester) async {
      final opened = Opened();
      watchClipboard(tester);
      await showDraft(tester, aDraft(contact: advising()), openDraft: opened.call);

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_messageField, 'My own words');
      await tapThrough(tester, find.text('Save'));
      await tapThrough(tester, find.text('Open in Outlook'));

      expect(opened.emails.single.body, 'My own words');
    });
  });

  group('Copy', () {
    testWidgets('puts the message on the clipboard, says so, and tells the backend nothing', (tester) async {
      final handle = tester.ensureSemantics();
      final copied = watchClipboard(tester);
      final backend = FakeBackend();
      await showDraft(tester, aDraft(contact: advising()), backend: backend);

      await tapThrough(tester, find.text('Copy'));

      expect(copied, [body]);
      final said = find.text('Copied the message.');
      expect(said, findsOneWidget);
      expect(tester.getSemantics(said).flagsCollection.isLiveRegion, isTrue);
      expect(backend.draftEdits, isEmpty);
      expect(backend.sent, isEmpty);
      handle.dispose();
    });

    testWidgets('says so if it could not', (tester) async {
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.setData') throw PlatformException(code: 'no');
        return null;
      });
      addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform, null));
      await showDraft(tester, aDraft(contact: advising()));

      await tapThrough(tester, find.text('Copy'));

      expect(find.textContaining("couldn't copy"), findsOneWidget);
    });
  });

  group('Edit', () {
    testWidgets('opens the words, and tells the Student they can delete the AI line', (tester) async {
      await showDraft(tester, aDraft(contact: advising()));

      await tapThrough(tester, find.text('Edit'));

      expect(find.text('Edit Draft'), findsOneWidget);
      expect(tester.widget<TextField>(_subjectField).controller!.text, 'Hold on my account');
      expect(tester.widget<TextField>(_messageField).controller!.text, body);
      expect(find.textContaining('you can delete it'), findsOneWidget);
    });

    testWidgets('saves the Student\'s words and shows them on the card', (tester) async {
      final backend = FakeBackend();
      await showDraft(tester, aDraft(contact: advising()), backend: backend);

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_subjectField, 'My hold');
      await tester.enterText(_messageField, 'Can you help?');
      await tapThrough(tester, find.text('Save'));

      expect(backend.draftEdits, [(3, 'My hold', 'Can you help?')]);
      expect(find.text('Edit Draft'), findsNothing);
      expect(find.text('Subject: My hold'), findsOneWidget);
      expect(find.text('Can you help?'), findsOneWidget);
      expect(find.text('Your changes are saved.'), findsOneWidget);
    });

    testWidgets('lets the Student delete the AI line', (tester) async {
      final backend = FakeBackend();
      await showDraft(tester, aDraft(contact: advising()), backend: backend);

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_messageField, body.replaceAll('\n\n$aiLine', ''));
      await tapThrough(tester, find.text('Save'));

      expect(find.textContaining(aiLine), findsNothing);
    });

    testWidgets('says when something the Student typed was hidden', (tester) async {
      final backend = FakeBackend()..draftEditHiddenNote = 'Buddy hid what looks like a password.';
      await showDraft(tester, aDraft(contact: advising()), backend: backend);

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_messageField, 'My password is hunter2');
      await tapThrough(tester, find.text('Save'));

      expect(find.text('Buddy hid what looks like a password.'), findsOneWidget);
    });

    testWidgets('keeps the Student\'s words on the screen when saving fails', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend()..draftEditError = const BackendException('offline');
      await showDraft(tester, aDraft(contact: advising()), backend: backend);

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_messageField, 'My own words');
      await tapThrough(tester, find.text('Save'));

      expect(find.text('Edit Draft'), findsOneWidget);
      expect(tester.widget<TextField>(_messageField).controller!.text, 'My own words');
      final problem = find.textContaining("couldn't save");
      expect(problem, findsOneWidget);
      expect(tester.getSemantics(problem).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('can\'t save a Draft with no message', (tester) async {
      await showDraft(tester, aDraft(contact: advising()));

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_messageField, '   ');
      await tester.pump();

      expect(tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save')).onPressed, isNull);
    });

    testWidgets('going back keeps the Draft as it was', (tester) async {
      final backend = FakeBackend();
      await showDraft(tester, aDraft(contact: advising()), backend: backend);

      await tapThrough(tester, find.text('Edit'));
      await tester.enterText(_messageField, 'Changed my mind');
      await tapThrough(tester, find.text('Cancel'));

      expect(backend.draftEdits, isEmpty);
      expect(find.text(body), findsOneWidget);
    });
  });

  group('with a screen reader', () {
    testWidgets('the card and the edit screen meet the guidelines', (tester) async {
      final handle = tester.ensureSemantics();
      await showDraft(tester, aDraft(contact: advising()));

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));

      await tapThrough(tester, find.text('Edit'));

      await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
      await expectLater(tester, meetsGuideline(textContrastGuideline));
      handle.dispose();
    });

    testWidgets('the card reads as one item, with each button named for its Contact', (tester) async {
      final handle = tester.ensureSemantics();
      await showDraft(tester, aDraft(contact: advising()));

      expect(
        find.bySemanticsLabel(RegExp(r'^Draft to Academic Advising Office\..*Why them: They help.*Subject: Hold on my account.*Can you help with my hold\?', dotAll: true)),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('Edit the Draft to Academic Advising Office'), findsOneWidget);
      expect(find.bySemanticsLabel('Open the Draft to Academic Advising Office in Outlook'), findsOneWidget);
      expect(find.bySemanticsLabel('Copy the Draft to Academic Advising Office'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('the edit screen\'s fields have their names and its heading is a heading', (tester) async {
      final handle = tester.ensureSemantics();
      await showDraft(tester, aDraft(contact: advising()));

      await tapThrough(tester, find.text('Edit'));

      expect(tester.getSemantics(_subjectField).label, contains('Subject'));
      expect(tester.getSemantics(_messageField).label, contains('Message'));
      expect(tester.getSemantics(find.text('Edit Draft')).flagsCollection.isHeader, isTrue);
      handle.dispose();
    });
  });

  group('with larger text', () {
    void useLargeText(WidgetTester tester) {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
    }

    testWidgets('everything on the card fits at twice the size on a small phone', (tester) async {
      useLargeText(tester);
      watchClipboard(tester);
      await showDraft(tester, aDraft(contact: advising()), size: const Size(320, 640));

      for (final label in ['Open in Outlook', 'Copy', 'Edit']) {
        await tester.ensureVisible(find.text(label));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'overflow near $label');
      }
      await tapThrough(tester, find.text('Open in Outlook'));
      expect(tester.takeException(), isNull, reason: 'overflow with the message showing');
    });

    testWidgets('the edit screen fits at twice the size on a small phone, and Save can be reached', (tester) async {
      useLargeText(tester);
      await showDraft(tester, aDraft(contact: advising()), size: const Size(320, 640));

      await tapThrough(tester, find.text('Edit'));
      expect(tester.takeException(), isNull);

      await tester.ensureVisible(find.text('Save'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('Save'));
      await tester.pumpAndSettle();
      expect(find.text('Edit Draft'), findsNothing);
    });
  });

  testWidgets('Activity shows a Draft in the backend\'s own words', (tester) async {
    final backend = FakeBackend()
      ..activity = [
        ActivityEntry(
          title: 'Buddy wrote a Draft to Academic Advising Office',
          detail: 'Subject: Hold on my account\n\n$body',
          at: DateTime.utc(2026, 11, 2, 14),
        ),
      ];

    await tester.pumpWidget(MaterialApp(home: ActivityScreen(backend: backend)));
    await tester.pump();

    expect(find.text('Buddy wrote a Draft to Academic Advising Office'), findsOneWidget);
    expect(find.textContaining('Can you help with my hold?'), findsOneWidget);
  });

  group('talking to the backend', () {
    final baseUrl = Uri.parse('http://backend.test');
    final draftJson = {
      'id': 3,
      'contact': {
        'id': 7,
        'kind': 'contact',
        'name': 'Academic Advising Office',
        'summary': 'Helps with holds.',
        'cost': null,
        'phone': null,
        'phoneToDial': null,
        'email': 'advising@temple.test',
        'place': null,
        'hours': null,
        'sources': [
          {'url': 'https://advising.temple.edu/contact', 'title': 'Contact', 'lastSeenAt': '2026-11-02T14:00:00.000Z'},
        ],
      },
      'why': 'They help.',
      'subject': 'Hold',
      'body': body,
      'createdAt': '2026-11-02T14:00:00.000Z',
      'editedAt': null,
    };

    test('reads a Draft from the history, with or without its Contact', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient(
          (_) async => http.Response(
            jsonEncode({
              'messages': [
                {'type': 'draft_card', 'draft': draftJson, 'sentAt': '2026-11-02T14:00:00.000Z'},
                {
                  'type': 'draft_card',
                  'draft': {...draftJson, 'contact': null, 'why': null},
                  'sentAt': '2026-11-02T14:00:00.000Z',
                },
              ],
            }),
            200,
          ),
        ),
      );

      final history = await backend.loadHistory();

      final [first as DraftCardItem, second as DraftCardItem] = history;
      expect(first.draft.contact!.email, 'advising@temple.test');
      expect(first.draft.why, 'They help.');
      expect(first.draft.subject, 'Hold');
      expect(first.draft.body, body);
      expect(second.draft.contact, isNull);
      expect(second.draft.why, isNull);
    });

    test('reads a Draft as it arrives in a reply', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient.streaming((_, _) async {
          final event = 'data: ${jsonEncode({'type': 'draft_card', 'draft': draftJson})}\n\n';
          return http.StreamedResponse(Stream.value(utf8.encode(event)), 200);
        }),
      );

      final events = await backend.send('Hi').toList();

      expect((events.single as ReplyDraftCard).draft.id, 3);
    });

    test('saves an edit with the phone\'s key and reads back what was hidden', () async {
      late http.Request sent;
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          sent = request;
          return http.Response(
            jsonEncode({
              'draft': {...draftJson, 'subject': 'New', 'body': '[password hidden]'},
              'hiddenNote': 'Buddy hid it.',
            }),
            200,
          );
        }),
      );

      final edited = await backend.editDraft(3, subject: 'New', body: 'My password is hunter2');

      expect(sent.method, 'PATCH');
      expect(sent.url.path, '/drafts/3');
      expect(sent.headers['authorization'], 'Bearer the-key');
      expect(jsonDecode(sent.body), {'subject': 'New', 'body': 'My password is hunter2'});
      expect(edited.draft.body, '[password hidden]');
      expect(edited.hiddenNote, 'Buddy hid it.');
    });

    test('a refused key is noticed when saving an edit', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () => refused = true,
        client: MockClient((_) async => http.Response('{}', 401)),
      );

      await expectLater(backend.editDraft(3, subject: 'New', body: 'Hi'), throwsA(isA<BackendException>()));
      expect(refused, isTrue);
    });
  });
}
