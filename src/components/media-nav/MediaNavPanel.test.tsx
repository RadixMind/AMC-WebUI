import { setupProviderTestRenderer as setupTestRenderer } from '@/test/render/providerRenderer';
import { fireEvent, screen, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MediaNavPanel } from './MediaNavPanel';
import { useMediaNavStore } from '@/stores/mediaNavStore';
import { useChatStore } from '@/stores/chatStore';
import type { UploadedFile } from '@/types';

vi.mock('./MediaNavView', () => ({
  MediaNavView: ({ file }: { file: UploadedFile }) => <div data-testid="mock-media-nav-view">{file.name}</div>,
}));

vi.mock('@/components/shared/file-preview/PdfViewerEntry', () => ({
  PdfViewer: ({ file }: { file: UploadedFile }) => <div data-testid="mock-pdf-viewer">{file.name}</div>,
}));

const mockVideoFile: UploadedFile = {
  id: 'vid-1',
  name: 'clip.mp4',
  type: 'video/mp4',
  size: 1024,
};

describe('MediaNavPanel', () => {
  const renderer = setupTestRenderer({ providers: { language: 'en' } });

  beforeEach(() => {
    useMediaNavStore.setState({
      isOpen: false,
      openKind: null,
      activeFileId: null,
      width: 480,
    });
    useChatStore.setState({
      selectedFiles: [],
      activeMessages: [],
    });
  });

  it('renders nothing when isOpen is false', () => {
    renderer.render(<MediaNavPanel />);
    expect(renderer.container.firstChild).toBeNull();
  });

  it('closes panel without resetting nav settings when close button is clicked', () => {
    const setCurrentChatSettings = vi.fn();
    useMediaNavStore.setState({
      isOpen: true,
      openKind: 'video',
      activeFileId: 'vid-1',
    });
    useChatStore.setState({
      selectedFiles: [mockVideoFile],
      activeMessages: [],
      setCurrentChatSettings,
    } as never);

    renderer.render(<MediaNavPanel />);

    const closeBtn = screen.getByTestId('media-nav-panel-close');
    expect(closeBtn).toBeDefined();

    fireEvent.click(closeBtn);

    // Verify useMediaNavStore isOpen was properly set to false, but settings were not wiped
    expect(useMediaNavStore.getState().isOpen).toBe(false);
    expect(setCurrentChatSettings).not.toHaveBeenCalled();
  });

  it('formats YouTube URLs as friendly display names in file title and options', () => {
    const youtubeFile: UploadedFile = {
      id: 'yt-1',
      name: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      type: 'video/mp4',
      size: 0,
    };
    useMediaNavStore.setState({
      isOpen: true,
      openKind: 'video',
      activeFileId: 'yt-1',
    });
    useChatStore.setState({
      selectedFiles: [youtubeFile],
      activeMessages: [],
    });

    renderer.render(<MediaNavPanel />);

    expect(screen.getByText('YouTube (dQw4w9WgXcQ)')).toBeDefined();
  });

  it('switches media kind and clears live artifacts from chat settings', () => {
    const audioFile: UploadedFile = {
      id: 'aud-1',
      name: 'voice.mp3',
      type: 'audio/mp3',
      size: 512,
    };
    const setCurrentChatSettings = vi.fn();
    useMediaNavStore.setState({
      isOpen: true,
      openKind: 'video',
      activeFileId: 'vid-1',
    });
    useChatStore.setState({
      selectedFiles: [mockVideoFile, audioFile],
      activeMessages: [],
      setCurrentChatSettings,
    } as never);

    renderer.render(<MediaNavPanel />);

    const select = screen.getByLabelText('Media Navigation');
    fireEvent.change(select, { target: { value: 'aud-1' } });

    expect(useMediaNavStore.getState().openKind).toBe('audio');
    expect(setCurrentChatSettings).toHaveBeenCalledWith(expect.any(Function));

    const updater = setCurrentChatSettings.mock.calls[0][0];
    const nextSettings = updater({
      isAudioNavEnabled: false,
      isVideoNavEnabled: true,
      systemInstruction: '[LiveUI Inline Protocol]\nPrompt',
    });
    expect(nextSettings.isAudioNavEnabled).toBe(true);
    expect(nextSettings.isVideoNavEnabled).toBe(false);
    expect(nextSettings.systemInstruction).toBe('');
  });

  it('renders empty state hint and clears activeFileId when requested openKind has no matching files in session', () => {
    const pdfFile: UploadedFile = {
      id: 'pdf-1',
      name: 'doc.pdf',
      type: 'application/pdf',
      size: 1024,
    };
    useMediaNavStore.setState({
      isOpen: true,
      openKind: 'video',
      activeFileId: null,
    });
    useChatStore.setState({
      selectedFiles: [pdfFile],
      activeMessages: [],
    });

    renderer.render(<MediaNavPanel />);

    expect(screen.queryByTestId('mock-media-nav-view')).toBeNull();
    expect(screen.queryByTestId('mock-pdf-viewer')).toBeNull();
    expect(
      screen.getByText(
        'Attach a PDF, video, audio, or image with the attachment button to browse it here while chatting.',
      ),
    ).toBeDefined();
    expect(useMediaNavStore.getState().activeFileId).toBeNull();
  });

  it('renders fixed full-screen without relative class on mobile', async () => {
    const useDeviceModule = await import('@/hooks/ui/useDevice');
    const isMobileSpy = vi.spyOn(useDeviceModule, 'useIsMobile').mockReturnValue(true);

    try {
      useMediaNavStore.setState({
        isOpen: true,
        openKind: 'video',
        activeFileId: 'vid-1',
      });
      useChatStore.setState({
        selectedFiles: [mockVideoFile],
        activeMessages: [],
      });

      renderer.render(<MediaNavPanel />);

      const panel = screen.getByTestId('media-nav-panel');
      expect(panel.className).toContain('fixed');
      expect(panel.className).toContain('inset-0');
      expect(panel.className).not.toContain('relative');
    } finally {
      isMobileSpy.mockRestore();
    }
  });

  it('supports drag resizing, keyboard resizing, and double-click reset', () => {
    useMediaNavStore.setState({
      isOpen: true,
      openKind: 'video',
      activeFileId: 'vid-1',
      width: 500,
    });
    useChatStore.setState({
      selectedFiles: [mockVideoFile],
      activeMessages: [],
    });

    renderer.render(<MediaNavPanel />);

    const handle = screen.getByTestId('medianav-resize-handle');
    expect(handle).toBeDefined();
    expect(handle.getAttribute('aria-valuenow')).toBe('500');

    // Drag resize: mousedown -> mousemove -> mouseup
    fireEvent.mouseDown(handle);
    // Simulating dragging left on a 1920px screen: clientX = 1000 -> width = 1920 - 1000 = 920
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
    try {
      act(() => {
        fireEvent.mouseMove(window, { clientX: 1000 });
      });
      expect(useMediaNavStore.getState().width).toBe(920);

      act(() => {
        fireEvent.mouseUp(window);
      });

      // Keyboard resize: ArrowLeft increases width
      act(() => {
        fireEvent.keyDown(handle, { key: 'ArrowLeft' });
      });
      expect(useMediaNavStore.getState().width).toBe(940);

      // Keyboard resize: ArrowRight decreases width
      act(() => {
        fireEvent.keyDown(handle, { key: 'ArrowRight' });
      });
      expect(useMediaNavStore.getState().width).toBe(920);

      // Double-click reset restores default width (540)
      act(() => {
        fireEvent.doubleClick(handle);
      });
      expect(useMediaNavStore.getState().width).toBe(540);

      // Keyboard Home resets width as well
      act(() => {
        useMediaNavStore.setState({ width: 700 });
        fireEvent.keyDown(handle, { key: 'Home' });
      });
      expect(useMediaNavStore.getState().width).toBe(540);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    }
  });

  it('clamps width when window resize event is triggered', () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 2560, configurable: true });
    try {
      useMediaNavStore.setState({
        isOpen: true,
        openKind: 'video',
        activeFileId: 'vid-1',
        width: 1500,
      });
      useChatStore.setState({
        selectedFiles: [mockVideoFile],
        activeMessages: [],
      });

      renderer.render(<MediaNavPanel />);

      // Shrink window to 1024px (where maxAllowed is 644)
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
      act(() => {
        fireEvent(window, new Event('resize'));
      });

      expect(useMediaNavStore.getState().width).toBe(644);
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    }
  });
});
