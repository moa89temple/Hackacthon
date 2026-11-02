import 'dart:convert';

import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  final baseUrl = Uri.parse('http://backend.test');

  test('loads the conversation history', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/conversation/messages');
        return http.Response(
          jsonEncode({
            'messages': [
              {
                'id': 1,
                'role': 'student',
                'text': 'Hello',
                'sentAt': '2026-11-02T14:00:00.000Z',
              },
              {
                'id': 3,
                'role': 'buddy',
                'text': 'Hi there',
                'sentAt': '2026-11-02T14:00:00.000Z',
              },
            ],
          }),
          200,
        );
      }),
    );

    final history = await backend.loadHistory();

    final messages = history.cast<ChatMessage>();
    expect(messages.map((message) => message.text), ['Hello', 'Hi there']);
    expect(messages.map((message) => message.isFromBuddy), [false, true]);
  });

  test('puts the opening first, in Buddy\'s voice, even with nothing else to load', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient((request) async {
        return http.Response(jsonEncode({'opening': 'I am Buddy.', 'messages': []}), 200);
      }),
    );

    final history = await backend.loadHistory();

    expect((history.single as ChatMessage).text, 'I am Buddy.');
    expect((history.single as ChatMessage).isFromBuddy, isTrue);
  });

  test('reads the hidden note on a message in the history', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient((request) async {
        return http.Response(
          jsonEncode({
            'messages': [
              {'id': 1, 'role': 'student', 'text': '[password hidden]', 'hiddenNote': 'Buddy hid it.'},
            ],
          }),
          200,
        );
      }),
    );

    final history = await backend.loadHistory();

    expect((history.single as ChatMessage).hiddenNote, 'Buddy hid it.');
  });

  test('reads the hidden event', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient.streaming((request, body) async {
        return http.StreamedResponse(
          Stream.value(utf8.encode('data: {"type":"hidden","text":"[password hidden]","note":"Buddy hid it."}\n\n')),
          200,
        );
      }),
    );

    final event = (await backend.send('Hello').toList()).single as ReplyHidden;

    expect(event.text, '[password hidden]');
    expect(event.note, 'Buddy hid it.');
  });

  group('Profile facts', () {
    const factJson = {
      'id': 7,
      'text': 'Is a junior.',
      'origin': {'type': 'conversation', 'messageId': 1},
      'savedAt': '2026-11-02T14:00:00.000Z',
      'editedAt': null,
    };

    test('loads them with where each came from', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/profile/facts');
          return http.Response(
            jsonEncode({
              'facts': [
                factJson,
                {...factJson, 'id': 8, 'editedAt': '2026-11-03T14:00:00.000Z'},
              ],
            }),
            200,
          );
        }),
      );

      final facts = await backend.loadFacts();

      expect(facts.map((fact) => fact.id), [7, 8]);
      expect(facts[0].text, 'Is a junior.');
      expect(facts[0].isFromConversation, isTrue);
      expect(facts[0].savedAt, DateTime.utc(2026, 11, 2, 14));
      expect(facts.map((fact) => fact.wasEdited), [false, true]);
    });

    test('sends an edit and reads the fact and any note that come back', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'PATCH');
          expect(request.url.path, '/profile/facts/7');
          expect(jsonDecode(request.body), {'text': 'Is a senior.'});
          return http.Response(jsonEncode({'fact': factJson, 'hiddenNote': 'Buddy hid it.'}), 200);
        }),
      );

      final edited = await backend.editFact(7, 'Is a senior.');

      expect(edited!.fact.id, 7);
      expect(edited.hiddenNote, 'Buddy hid it.');
    });

    test('reports an edit of a fact that is gone as nothing to show', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async => http.Response('{}', 404)),
      );

      expect(await backend.editFact(7, 'Is a senior.'), isNull);
    });

    test('deletes one, and a fact already gone counts as deleted', () async {
      final statuses = [204, 404];
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'DELETE');
          expect(request.url.path, '/profile/facts/7');
          return http.Response('', statuses.removeAt(0));
        }),
      );

      await backend.deleteFact(7);
      await backend.deleteFact(7);

      expect(statuses, isEmpty);
    });

    test('fails on any other error', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async => http.Response('{}', 500)),
      );

      await expectLater(backend.loadFacts(), throwsA(isA<BackendException>()));
      await expectLater(backend.editFact(7, 'Anything'), throwsA(isA<BackendException>()));
      await expectLater(backend.deleteFact(7), throwsA(isA<BackendException>()));
    });
  });

  test('fails loudly when the history cannot be loaded', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient((request) async => http.Response('nope', 500)),
    );

    expect(backend.loadHistory(), throwsA(isA<BackendException>()));
  });

  test('posts the message and reads events however the bytes are split', () async {
    late String postedBody;
    // Split mid-frame and in the middle of a two-byte character.
    final frames = utf8.encode(
      'data: {"type":"text","text":"café "}\n\n'
      'data: {"type":"text","text":"time"}\n\n'
      'data: {"type":"done","reply":{"id":3,"role":"buddy",'
      '"text":"café time","sentAt":"2026-11-02T14:00:00.000Z"}}\n\n',
    );
    final accent = frames.indexOf(0xC3) + 1;
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient.streaming((request, body) async {
        postedBody = await body.bytesToString();
        return http.StreamedResponse(
          Stream.fromIterable([frames.sublist(0, accent), frames.sublist(accent)]),
          200,
        );
      }),
    );

    final events = await backend.send('Coffee?').toList();

    expect(jsonDecode(postedBody), {'text': 'Coffee?'});
    expect(events, hasLength(3));
    expect((events[0] as ReplyText).text, 'café ');
    expect((events[1] as ReplyText).text, 'time');
    expect((events[2] as ReplyDone).reply.text, 'café time');
  });

  test('passes on the error event from the backend', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient.streaming((request, body) async {
        return http.StreamedResponse(
          Stream.value(utf8.encode('data: {"type":"error","message":"Try again."}\n\n')),
          200,
        );
      }),
    );

    final events = await backend.send('Hello').toList();

    expect((events.single as ReplyFailed).message, 'Try again.');
  });

  test('ignores event types this version of the app does not know', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient.streaming((request, body) async {
        return http.StreamedResponse(
          Stream.value(utf8.encode(
            'data: {"type":"card","card":{}}\n\ndata: {"type":"text","text":"Hi"}\n\n',
          )),
          200,
        );
      }),
    );

    final events = await backend.send('Hello').toList();

    expect((events.single as ReplyText).text, 'Hi');
  });

  test('reads the Crisis card event, wherever it comes in the turn', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient.streaming((request, body) async {
        return http.StreamedResponse(
          Stream.value(utf8.encode('data: {"type":"crisis_card"}\n\ndata: {"type":"text","text":"Hi"}\n\n')),
          200,
        );
      }),
    );

    final events = await backend.send('Hello').toList();

    expect(events[0], isA<ReplyCrisisCard>());
    expect((events[1] as ReplyText).text, 'Hi');
  });

  test('loads a Crisis card from the history in its place', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient((request) async {
        return http.Response(
          jsonEncode({
            'messages': [
              {'id': 1, 'role': 'student', 'text': 'Help', 'sentAt': '2026-11-02T14:00:00.000Z'},
              {'type': 'crisis_card', 'sentAt': '2026-11-02T14:00:00.000Z'},
              {'id': 3, 'role': 'buddy', 'text': 'I am here.', 'sentAt': '2026-11-02T14:00:00.000Z'},
            ],
          }),
          200,
        );
      }),
    );

    final history = await backend.loadHistory();

    expect(history[0], isA<ChatMessage>());
    expect(history[1], isA<CrisisCardItem>());
    expect((history[2] as ChatMessage).text, 'I am here.');
  });

  test('fails when the backend rejects the message', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient.streaming((request, body) async {
        return http.StreamedResponse(const Stream.empty(), 400);
      }),
    );

    expect(backend.send('Hello').toList(), throwsA(isA<BackendException>()));
  });

  group('Takeovers', () {
    const takeoverJson = {
      'site': 'canvas',
      'siteName': 'Canvas',
      'liveViewPath': '/takeover/live/token/takeover.html',
    };

    test('starts one and makes the live view an address on the backend', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, '/takeover');
          expect(jsonDecode(request.body), {'site': 'canvas'});
          return http.Response(jsonEncode({'takeover': takeoverJson}), 200);
        }),
      );

      final takeover = await backend.startTakeover('canvas');

      expect(takeover.siteName, 'Canvas');
      expect(takeover.liveViewUrl, Uri.parse('http://backend.test/takeover/live/token/takeover.html'));
    });

    test('fails to start when the browser cannot be reached', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async => http.Response('{}', 503)),
      );

      expect(backend.startTakeover('canvas'), throwsA(isA<BackendException>()));
    });

    test('reports the Takeover under way, or none', () async {
      var body = {'takeover': takeoverJson};
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/takeover');
          return http.Response(jsonEncode(body), 200);
        }),
      );

      expect((await backend.currentTakeover())!.site, 'canvas');

      body = {};
      expect(await backend.currentTakeover(), isNull);
    });

    test('finishes one and reads what came of it', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'POST');
          expect(request.url.path, '/takeover/done');
          return http.Response(
            jsonEncode({'site': 'canvas', 'siteName': 'Canvas', 'signedIn': true, 'title': 'Dashboard'}),
            200,
          );
        }),
      );

      final finished = await backend.finishTakeover();

      expect(finished!.signedIn, isTrue);
      expect(finished.title, 'Dashboard');
    });

    test('treats finishing a Takeover that already ended as nothing to report', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async => http.Response('{}', 409)),
      );

      expect(await backend.finishTakeover(), isNull);
    });

    test('fails to finish on any other error, so the app can try again', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async => http.Response('{}', 500)),
      );

      expect(backend.finishTakeover(), throwsA(isA<BackendException>()));
    });
  });

  group('the device key', () {
    const authorization = 'Bearer the-key';

    test('goes with every operation', () async {
      final seen = <String, String?>{};
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          seen['${request.method} ${request.url.path}'] = request.headers['authorization'];
          return switch (request.url.path) {
            '/conversation/messages' when request.method == 'GET' => http.Response('{"messages":[]}', 200),
            '/conversation/messages' => http.Response('', 200),
            '/takeover/done' => http.Response('{"siteName":"Canvas","signedIn":true}', 200),
            '/profile/facts' => http.Response('{"facts":[]}', 200),
            '/profile/facts/1' => http.Response('', 404),
            _ => http.Response(
                '{"takeover":{"site":"canvas","siteName":"Canvas","liveViewPath":"/takeover/live/t/takeover.html"}}',
                200,
              ),
          };
        }),
      );

      await backend.loadHistory();
      await backend.send('Hello').drain<void>();
      await backend.currentTakeover();
      await backend.startTakeover('canvas');
      await backend.finishTakeover();
      await backend.loadFacts();
      await backend.editFact(1, 'Anything');
      await backend.deleteFact(1);

      expect(seen, {
        'GET /profile/facts': authorization,
        'PATCH /profile/facts/1': authorization,
        'DELETE /profile/facts/1': authorization,
        'GET /conversation/messages': authorization,
        'POST /conversation/messages': authorization,
        'GET /takeover': authorization,
        'POST /takeover': authorization,
        'POST /takeover/done': authorization,
      });
    });

    test('is what the live view opens with', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient(
          (request) async => http.Response(
            '{"takeover":{"site":"canvas","siteName":"Canvas","liveViewPath":"/takeover/live/t/takeover.html"}}',
            200,
          ),
        ),
      );

      final takeover = await backend.startTakeover('canvas');

      expect(takeover.liveViewHeaders, {'authorization': authorization});
    });

    group('when the backend refuses it', () {
      late int refusals;
      late HttpBuddyBackend backend;

      setUp(() {
        refusals = 0;
        backend = HttpBuddyBackend(
          baseUrl,
          deviceKey: 'the-key',
          onKeyRefused: () => refusals++,
          client: MockClient((request) async => http.Response('{"error":"no"}', 401)),
        );
      });

      final operations = <String, Future<void> Function()>{
        'loading the history': () => backend.loadHistory(),
        'sending a message': () => backend.send('Hello').drain<void>(),
        'checking for a Takeover': () => backend.currentTakeover(),
        'starting a Takeover': () => backend.startTakeover('canvas'),
        'finishing a Takeover': () => backend.finishTakeover(),
        'loading the Profile': () => backend.loadFacts(),
        'editing a fact': () => backend.editFact(1, 'Anything'),
        'deleting a fact': () => backend.deleteFact(1),
      };

      operations.forEach((name, operation) {
        test('$name fails and reports it', () async {
          await expectLater(operation(), throwsA(isA<BackendException>()));
          expect(refusals, 1);
        });
      });
    });

    test('other failures do not count as a refused key', () async {
      var refusals = 0;
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () => refusals++,
        client: MockClient((request) async => http.Response('nope', 503)),
      );

      await expectLater(backend.loadHistory(), throwsA(isA<BackendException>()));

      expect(refusals, 0);
    });
  });
}
