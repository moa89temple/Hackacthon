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

    expect(history.map((message) => message.text), ['Hello', 'Hi there']);
    expect(history.map((message) => message.isFromBuddy), [false, true]);
  });

  test('fails loudly when the history cannot be loaded', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
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

  test('fails when the backend rejects the message', () async {
    final backend = HttpBuddyBackend(
      baseUrl,
      client: MockClient.streaming((request, body) async {
        return http.StreamedResponse(const Stream.empty(), 400);
      }),
    );

    expect(backend.send('Hello').toList(), throwsA(isA<BackendException>()));
  });
}
