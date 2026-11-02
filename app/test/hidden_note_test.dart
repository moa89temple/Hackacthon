import 'package:buddy/backend/buddy_backend.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_backend.dart';
import 'support/test_app.dart';

const typed = 'my password is hunter2';
const kept = 'my password is [password hidden]';
const note = 'Buddy hid what looks like a password before saving this or sending it to the AI.';

void main() {
  testWidgets('swaps what the Student typed for what Buddy kept, and shows the note', (tester) async {
    final backend = FakeBackend();
    await openUnlockedApp(tester, backend);
    await sendMessage(tester, typed);
    expect(find.text(typed), findsOneWidget);

    backend.reply.add(const ReplyHidden(text: kept, note: note));
    await tester.pump();

    expect(find.text(typed), findsNothing);
    expect(find.text(kept), findsOneWidget);
    expect(find.text(note), findsOneWidget);
  });

  testWidgets('keeps both through the rest of the turn', (tester) async {
    final backend = FakeBackend();
    await openUnlockedApp(tester, backend);
    await sendMessage(tester, typed);

    backend.reply
      ..add(const ReplyHidden(text: kept, note: note))
      ..add(ReplyDone(buddy('Thanks.')));
    await backend.reply.close();
    await tester.pump();

    expect(find.text(kept), findsOneWidget);
    expect(find.text(note), findsOneWidget);
    expect(find.text('Thanks.'), findsOneWidget);
    expect(find.text(typed), findsNothing);
  });

  testWidgets('is there again when the conversation loads from history', (tester) async {
    await openUnlockedApp(
      tester,
      FakeBackend(history: [const ChatMessage(isFromBuddy: false, text: kept, hiddenNote: note)]),
    );

    expect(find.text(kept), findsOneWidget);
    expect(find.text(note), findsOneWidget);
  });

  testWidgets('shows no note on an ordinary message', (tester) async {
    await openUnlockedApp(tester, FakeBackend(history: [student('Hello')]));

    expect(find.textContaining('Buddy hid'), findsNothing);
  });

  group('accessibility', () {
    testWidgets('a screen reader hears the note as soon as it comes', (tester) async {
      final handle = tester.ensureSemantics();
      final backend = FakeBackend();
      await openUnlockedApp(tester, backend);
      await sendMessage(tester, typed);

      backend.reply.add(const ReplyHidden(text: kept, note: note));
      await tester.pump();

      final message = find.bySemanticsLabel('You said: $kept. $note');
      expect(message, findsOneWidget);
      expect(tester.getSemantics(message).flagsCollection.isLiveRegion, isTrue);
      handle.dispose();
    });

    testWidgets('a note from history is read with its message, not announced', (tester) async {
      final handle = tester.ensureSemantics();
      await openUnlockedApp(
        tester,
        FakeBackend(history: [const ChatMessage(isFromBuddy: false, text: kept, hiddenNote: note)]),
      );

      final message = find.bySemanticsLabel('You said: $kept. $note');
      expect(tester.getSemantics(message).flagsCollection.isLiveRegion, isFalse);
      handle.dispose();
    });

    testWidgets('it fits at twice the text size on a small phone', (tester) async {
      tester.view
        ..physicalSize = const Size(320, 640)
        ..devicePixelRatio = 1;
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.view.reset);
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);

      await openUnlockedApp(
        tester,
        FakeBackend(history: [const ChatMessage(isFromBuddy: false, text: kept, hiddenNote: note)]),
      );

      expect(tester.takeException(), isNull);
    });
  });
}
