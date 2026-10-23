import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { colors, tw } from '../../theme';
import { api, clientConfig, errorMessage } from '../../api/client';
import { NavHeader } from '../NavHeader';
import { ErrorState } from '../ui/StateViews';

// The WebView keeps its cookies for the app's lifetime, so one handoff per
// server signs every later editor in; a fresh one is only needed when the
// web session has gone (the page bounces to /login).
const signedIn = new Set<string>();

const editorPath = (pageId: string) => `/documents/${encodeURIComponent(pageId)}?embed=1`;

export function NoteEditorScreen({ pageId, title, onBack }: { pageId: string; title: string; onBack: () => void }) {
  const base = clientConfig().baseUrl;
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const retried = useRef(false);

  const signIn = useCallback(async () => {
    setError(null);
    setUri(null);
    try {
      const { url } = await api.editorSignIn(pageId);
      signedIn.add(base);
      setUri(url);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [base, pageId]);

  useEffect(() => {
    retried.current = false;
    if (signedIn.has(base)) setUri(`${base}${editorPath(pageId)}`);
    else void signIn();
  }, [base, pageId, signIn]);

  const onNavigation = (nav: WebViewNavigation) => {
    if (!nav.url.startsWith(`${base}/login`)) return;
    signedIn.delete(base);
    if (retried.current) {
      setError('Couldn’t sign in to the editor. Try again.');
      return;
    }
    retried.current = true;
    void signIn();
  };

  return (
    <View style={tw`flex-1 bg-white`}>
      <NavHeader title={title} subtitle="Edits save to DALI OS as you type" onBack={onBack} />
      {error ? (
        <ErrorState
          message={error}
          onRetry={() => {
            retried.current = false;
            void signIn();
          }}
        />
      ) : uri ? (
        <WebView
          source={{ uri }}
          onNavigationStateChange={onNavigation}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={tw`absolute inset-0 items-center justify-center bg-white`}>
              <ActivityIndicator color={colors.teal} />
            </View>
          )}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView
          setSupportMultipleWindows={false}
          style={tw`flex-1`}
        />
      ) : (
        <View style={tw`flex-1 items-center justify-center`}>
          <ActivityIndicator color={colors.teal} />
        </View>
      )}
    </View>
  );
}
