import 'package:flutter/material.dart';

import 'backend/buddy_backend.dart';
import 'chat/buddy_tab.dart';
import 'chat/chat_controller.dart';
import 'chat/crisis_card.dart';
import 'device/app_lock.dart';
import 'device/device_store.dart';
import 'device/lock_screen.dart';
import 'device/pairing_details.dart';
import 'device/pairing_screen.dart';
import 'device/qr_scanner.dart';
import 'tabs/simple_tabs.dart';
import 'tabs/you_tab.dart';
import 'takeover/live_view.dart';
import 'widgets/buddy_avatar.dart';

const templeCherry = Color(0xFF9D2235);

class BuddyApp extends StatefulWidget {
  const BuddyApp({
    super.key,
    required this.deviceStore,
    required this.appLock,
    required this.access,
    this.liveViewBuilder = webLiveView,
    this.qrScannerBuilder = cameraQrScanner,
    this.openPhone = openWithPhone,
  });

  final DeviceStore deviceStore;
  final AppLock appLock;
  final BackendAccess access;
  final LiveViewBuilder liveViewBuilder;
  final QrScannerBuilder qrScannerBuilder;
  final PhoneOpener openPhone;

  @override
  State<BuddyApp> createState() => _BuddyAppState();
}

/// Decides what the Student can reach. A phone with no device key can only pair. A paired phone
/// shows nothing and asks the backend for nothing until it's unlocked, and locks again whenever it
/// goes into the background.
class _BuddyAppState extends State<BuddyApp> with WidgetsBindingObserver {
  bool _readingDevice = true;
  PairedDevice? _device;
  BuddyBackend? _backend;
  String? _pairingNotice;

  bool _locked = true;
  bool _unlockedOnce = false;
  bool _asking = false;
  bool _askWhenBack = false;
  bool _blanked = false;
  UnlockResult? _lastResult;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _readDevice();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _readDevice() async {
    final device = await widget.deviceStore.read();
    if (!mounted) return;
    setState(() => _readingDevice = false);
    if (device != null) _usePairing(device);
  }

  Future<void> _pair(PairingDetails details) async {
    final device = await widget.access.pair(details);
    await widget.deviceStore.save(device);
    if (mounted) _usePairing(device);
  }

  void _usePairing(PairedDevice device) {
    setState(() {
      _device = device;
      _backend = widget.access.open(device, onKeyRefused: () => _unpair(device));
      _pairingNotice = null;
      _locked = true;
      _unlockedOnce = false;
      _lastResult = null;
    });
    _unlock();
  }

  Future<void> _unpair(PairedDevice device) async {
    // Every request under way can be refused at once, and a late one may belong to an old pairing.
    if (!identical(_device, device)) return;
    setState(() {
      _device = null;
      _backend = null;
      _pairingNotice = 'This phone is no longer paired with your laptop. Pair it again to keep using Buddy.';
    });
    await widget.deviceStore.forget();
  }

  Future<void> _unlock() async {
    if (_asking) return;
    setState(() => _asking = true);
    final result = await widget.appLock.unlock();
    if (!mounted) return;
    setState(() {
      _asking = false;
      _lastResult = result;
      if (result == UnlockResult.unlocked) {
        _locked = false;
        _unlockedOnce = true;
      }
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_device == null) return;
    switch (state) {
      // Inactive can also just mean the notification shade is opening, so it doesn't lock. But it's
      // the last moment the app can still draw, and whatever it draws last can show again for a
      // moment on the way back, so the screen goes blank here.
      case AppLifecycleState.inactive:
        setState(() => _blanked = true);
      case AppLifecycleState.hidden || AppLifecycleState.paused:
        // The phone's own screen lock is a screen of its own, so asking can send the app here.
        if (_asking) return;
        setState(() {
          _locked = true;
          _lastResult = null;
        });
        _askWhenBack = true;
      case AppLifecycleState.resumed:
        setState(() => _blanked = false);
        if (_askWhenBack) {
          _askWhenBack = false;
          _unlock();
        }
      case AppLifecycleState.detached:
        break;
    }
  }

  Widget get _home {
    if (_readingDevice) return const Scaffold();
    final backend = _backend;
    if (backend == null) {
      return PairingScreen(
        onPair: _pair,
        scannerBuilder: widget.qrScannerBuilder,
        notice: _pairingNotice,
      );
    }
    // Until the first unlock nothing exists behind the lock, not even the conversation.
    if (!_unlockedOnce) return const Scaffold();
    return _Tabs(backend: backend, liveViewBuilder: widget.liveViewBuilder, openPhone: widget.openPhone);
  }

  @override
  Widget build(BuildContext context) {
    final locked = _device != null && _locked;
    final hidden = locked || (_device != null && _blanked);
    return MaterialApp(
      // A new pairing starts over, including anything left open on the old one.
      key: ValueKey(_device),
      title: 'Buddy',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: templeCherry).copyWith(
          primary: templeCherry,
          onPrimary: Colors.white,
        ),
      ),
      home: _home,
      // Sits above the navigator, so that it covers every screen and they're all still there after.
      builder: (context, navigator) => Stack(
        fit: StackFit.expand,
        children: [
          Offstage(
            offstage: hidden,
            child: ExcludeFocus(excluding: hidden, child: navigator!),
          ),
          if (locked)
            LockScreen(asking: _asking, lastResult: _lastResult, onUnlock: _unlock)
          else if (hidden)
            const Scaffold(),
        ],
      ),
    );
  }
}

class _Tabs extends StatefulWidget {
  const _Tabs({required this.backend, required this.liveViewBuilder, required this.openPhone});

  final BuddyBackend backend;
  final LiveViewBuilder liveViewBuilder;
  final PhoneOpener openPhone;

  @override
  State<_Tabs> createState() => _TabsState();
}

class _TabsState extends State<_Tabs> {
  static const _titles = ['Buddy', 'Today', 'Roadmap', 'You'];

  late final ChatController _chat = ChatController(widget.backend)
    ..loadHistory()
    ..addListener(_showNewCrisisCard);
  CrisisCardItem? _cardShown;
  int _selected = 0;

  /// A Crisis card can arrive while the Student is on another tab, and they mustn't miss it.
  void _showNewCrisisCard() {
    final card = _chat.newestCard;
    if (card == null || identical(card, _cardShown)) return;
    _cardShown = card;
    setState(() => _selected = 0);
  }

  @override
  void dispose() {
    _chat.dispose();
    super.dispose();
  }

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
          BuddyTab(chat: _chat, openPhone: widget.openPhone),
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
