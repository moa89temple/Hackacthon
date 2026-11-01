import 'package:flutter/material.dart';

import 'backend/buddy_backend.dart';
import 'chat/buddy_tab.dart';
import 'chat/chat_controller.dart';
import 'tabs/simple_tabs.dart';
import 'tabs/you_tab.dart';
import 'takeover/live_view.dart';
import 'widgets/buddy_avatar.dart';

const templeCherry = Color(0xFF9D2235);

class BuddyApp extends StatefulWidget {
  const BuddyApp({super.key, required this.backend, this.liveViewBuilder = webLiveView});

  final BuddyBackend backend;
  final LiveViewBuilder liveViewBuilder;

  @override
  State<BuddyApp> createState() => _BuddyAppState();
}

class _BuddyAppState extends State<BuddyApp> {
  late final ChatController _chat = ChatController(widget.backend)..loadHistory();

  @override
  void dispose() {
    _chat.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Buddy',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: templeCherry).copyWith(
          primary: templeCherry,
          onPrimary: Colors.white,
        ),
      ),
      home: _Tabs(chat: _chat, backend: widget.backend, liveViewBuilder: widget.liveViewBuilder),
    );
  }
}

class _Tabs extends StatefulWidget {
  const _Tabs({required this.chat, required this.backend, required this.liveViewBuilder});

  final ChatController chat;
  final BuddyBackend backend;
  final LiveViewBuilder liveViewBuilder;

  @override
  State<_Tabs> createState() => _TabsState();
}

class _TabsState extends State<_Tabs> {
  static const _titles = ['Buddy', 'Today', 'Roadmap', 'You'];

  int _selected = 0;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: const Center(child: BuddyAvatar(radius: 18)),
        title: Text(_titles[_selected]),
      ),
      // An IndexedStack keeps each tab alive, along with what the Student was typing.
      body: IndexedStack(
        index: _selected,
        children: [
          BuddyTab(chat: widget.chat),
          const TodayTab(),
          const RoadmapTab(),
          YouTab(backend: widget.backend, liveViewBuilder: widget.liveViewBuilder),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selected,
        onDestinationSelected: (index) => setState(() => _selected = index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.chat_bubble_outline), selectedIcon: Icon(Icons.chat_bubble), label: 'Buddy'),
          NavigationDestination(icon: Icon(Icons.today_outlined), selectedIcon: Icon(Icons.today), label: 'Today'),
          NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Roadmap'),
          NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'You'),
        ],
      ),
    );
  }
}
