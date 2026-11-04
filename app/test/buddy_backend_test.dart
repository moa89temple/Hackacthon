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

  test('reads when each message was sent, and leaves the opening without a time', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      deviceKey: 'the-key',
      onKeyRefused: () {},
      client: MockClient((request) async => http.Response(
            jsonEncode({
              'opening': 'I am Buddy.',
              'messages': [
                {'id': 1, 'role': 'student', 'text': 'Hello', 'sentAt': '2026-11-02T14:00:00.000Z'},
              ],
            }),
            200,
          )),
    );

    final messages = (await backend.loadHistory()).cast<ChatMessage>();

    expect(messages.first.sentAt, isNull);
    expect(messages.last.sentAt, DateTime.utc(2026, 11, 2, 14));
  });

  group('the Guidebook', () {
    test('loads every item, and tells a Contact from a Resource', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async {
          expect(request.method, 'GET');
          expect(request.url.path, '/guidebook/items');
          expect(request.headers['authorization'], 'Bearer the-key');
          return http.Response(
            jsonEncode({
              'items': [
                {'id': 1, 'kind': 'resource', 'name': 'Writing Center', 'summary': 'Help with writing.', 'cost': 'Free', 'phone': null, 'phoneToDial': null, 'email': null, 'place': null, 'hours': null, 'sources': []},
                {'id': 2, 'kind': 'contact', 'name': 'Student Financial Services', 'summary': 'Help with bills.', 'cost': null, 'phone': null, 'phoneToDial': null, 'email': 'sfs@temple.edu', 'place': null, 'hours': null, 'sources': []},
              ],
            }),
            200,
          );
        }),
      );

      final items = await backend.loadGuidebook();

      expect(items.map((item) => item.name), ['Writing Center', 'Student Financial Services']);
      expect(items.map((item) => item.isContact), [false, true]);
    });

    test('throws when the backend refuses', () async {
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () {},
        client: MockClient((request) async => http.Response('', 500)),
      );

      expect(backend.loadGuidebook(), throwsA(isA<BackendException>()));
    });

    test('notices a refused key', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('', 401)),
      );

      await expectLater(backend.loadGuidebook(), throwsA(isA<BackendException>()));
      expect(refused, isTrue);
    });
  });

  test('a card can do without a reason', () {
    final without = ReadPermissionCardContent.fromJson({'reads': <String>[], 'notes': <String>[], 'warning': null, 'address': null});
    final withOne = ReadPermissionCardContent.fromJson({'why': 'So Buddy can help.', 'reads': <String>[], 'notes': <String>[], 'warning': null, 'address': null});

    expect(without.why, isNull);
    expect(withOne.why, 'So Buddy can help.');
  });

  test('an Activity entry says what kind it is, and an old one without a kind still reads', () {
    final withKind = ActivityEntry.fromJson({'kind': 'email_sent', 'title': 'Buddy sent an email', 'at': '2026-11-02T14:00:00.000Z'});
    final without = ActivityEntry.fromJson({'title': 'Something', 'at': '2026-11-02T14:00:00.000Z'});

    expect(withKind.kind, 'email_sent');
    expect(without.kind, '');
  });

  group('Connections', () {
    const keyHeader = 'Bearer the-key';
    final connectionJson = {
      'id': 'google-calendar',
      'name': 'Google Calendar',
      'on': true,
      'lastReadAt': '2026-11-02T14:00:00.000Z',
      'lastReadProblem': null,
      'card': {
        'reads': ['Each event.'],
        'notes': ['Good to know.'],
        'warning': null,
        'address': {
          'label': 'Secret address',
          'steps': ['Copy it.'],
        },
      },
    };

    HttpBuddyBackend backendAnswering(Future<http.Response> Function(http.Request request) answer) => HttpBuddyBackend(
          baseUrl,
          deviceKey: 'the-key',
          onKeyRefused: () {},
          client: MockClient(answer),
        );

    test('loads the list, with its card', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/connections');
        expect(request.headers['authorization'], keyHeader);
        return http.Response(jsonEncode({'connections': [connectionJson]}), 200);
      });

      final [connection] = await backend.loadConnections();

      expect(connection.id, 'google-calendar');
      expect(connection.on, isTrue);
      expect(connection.lastReadAt, DateTime.utc(2026, 11, 2, 14));
      expect(connection.lastReadProblem, isNull);
      expect(connection.card.reads, ['Each event.']);
      expect(connection.card.warning, isNull);
      expect(connection.card.address?.label, 'Secret address');
      expect(connection.card.address?.steps, ['Copy it.']);
    });

    test('reads what a service the Student asked for says about itself, which others leave empty', () async {
      final backend = backendAnswering((request) async {
        return http.Response(
          jsonEncode({
            'connections': [
              {...connectionJson, 'service': null},
              {
                ...connectionJson,
                'id': 'service-notion.com',
                'service': {'domain': 'notion.com', 'route': 'own_connector', 'routeInWords': 'Through its own connector'},
              },
            ],
          }),
          200,
        );
      });

      final [ownConnection, service] = await backend.loadConnections();

      expect(ownConnection.service, isNull);
      expect(service.service?.domain, 'notion.com');
      expect(service.service?.routeInWords, 'Through its own connector');
    });

    test('reads a card with a warning and no address', () async {
      final backend = backendAnswering((request) async {
        return http.Response(
          jsonEncode({
            'connections': [
              {
                ...connectionJson,
                'lastReadAt': null,
                'lastReadProblem': 'It failed.',
                'card': {'reads': <String>[], 'notes': <String>[], 'warning': 'Their rules forbid it.', 'address': null},
              },
            ],
          }),
          200,
        );
      });

      final [connection] = await backend.loadConnections();

      expect(connection.lastReadAt, isNull);
      expect(connection.lastReadProblem, 'It failed.');
      expect(connection.card.warning, 'Their rules forbid it.');
      expect(connection.card.address, isNull);
    });

    test('sends the address in the body when giving a Read Permission, never in the address bar', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/connections/google-calendar/read-permission');
        expect(request.url.query, isEmpty);
        expect(request.headers['authorization'], keyHeader);
        expect(jsonDecode(request.body), {'address': 'https://secret.test'});
        return http.Response(jsonEncode({'connection': connectionJson}), 200);
      });

      expect((await backend.giveReadPermission('google-calendar', 'https://secret.test')).on, isTrue);
    });

    for (final status in [400, 409]) {
      test('passes on what the backend says when it answers $status to a Read Permission', () async {
        final backend = backendAnswering((request) async => http.Response(jsonEncode({'error': 'Not that one.'}), status));

        await expectLater(
          backend.giveReadPermission('google-calendar', 'nope'),
          throwsA(isA<ReadPermissionRefused>().having((refused) => refused.message, 'message', 'Not that one.')),
        );
      });
    }

    test('revokes', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'DELETE');
        expect(request.url.path, '/connections/google-calendar/read-permission');
        expect(request.headers['authorization'], keyHeader);
        return http.Response(jsonEncode({'connection': {...connectionJson, 'on': false}}), 200);
      });

      expect((await backend.revokeReadPermission('google-calendar')).on, isFalse);
    });

    test('reads now', () async {
      final backend = backendAnswering((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/connections/google-calendar/read');
        expect(request.headers['authorization'], keyHeader);
        return http.Response(jsonEncode({'connection': connectionJson}), 200);
      });

      expect((await backend.readConnection('google-calendar')).name, 'Google Calendar');
    });

    test('treats a read refused for want of a Read Permission as a failure', () async {
      final backend = backendAnswering((request) async => http.Response(jsonEncode({'error': 'No.'}), 403));

      await expectLater(backend.readConnection('google-calendar'), throwsA(isA<BackendException>()));
    });

    test('notices when the key is refused', () async {
      var refused = false;
      final backend = HttpBuddyBackend(
        baseUrl,
        deviceKey: 'the-key',
        onKeyRefused: () => refused = true,
        client: MockClient((request) async => http.Response('', 401)),
      );

      await expectLater(backend.loadConnections(), throwsA(isA<BackendException>()));

      expect(refused, isTrue);
    });

    test('reads a fact from a Connection', () async {
      final backend = backendAnswering((request) async {
        return http.Response.bytes(
          utf8.encode(jsonEncode({
            'facts': [
              {
                'id': 1,
                'text': 'Shift at CVS',
                'detail': 'Tue, Nov 3, 2:00 PM–5:00 PM',
                'origin': {'type': 'connection', 'connection': 'google-calendar', 'name': 'Google Calendar'},
                'savedAt': '2026-11-02T14:00:00.000Z',
                'editedAt': null,
              },
            ],
          })),
          200,
        );
      });

      final [fact] = await backend.loadFacts();

      expect(fact.detail, 'Tue, Nov 3, 2:00 PM–5:00 PM');
      expect(fact.connectionName, 'Google Calendar');
      expect(fact.isFromConversation, isFalse);
    });

    test('puts a suggested card in its place in the history', () async {
      final backend = backendAnswering((request) async {
        return http.Response(
          jsonEncode({
            'messages': [
              {'type': 'read_permission_card', 'connection': 'google-calendar', 'sentAt': '2026-11-02T14:00:00.000Z'},
            ],
          }),
          200,
        );
      });

      final [item] = await backend.loadHistory();

      expect((item as ReadPermissionCardItem).connectionId, 'google-calendar');
    });

    test('hears when Buddy suggests a card during a turn', () async {
      final backend = backendAnswering((request) async {
        return http.Response.bytes(
          utf8.encode('data: ${jsonEncode({'type': 'read_permission_card', 'connection': 'google-calendar'})}\n\n'),
          200,
        );
      });

      final events = await backend.send('When?').toList();

      expect((events.single as ReplyReadPermissionCard).connectionId, 'google-calendar');
    });
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
