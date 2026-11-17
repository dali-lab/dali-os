import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { AlertCircle, Camera, CheckCircle2, Images, X } from 'lucide-react-native';
import { colors, tw } from '../../theme';
import { api, errorMessage } from '../../api/client';
import type { ExpenseUploadsResponse } from '../../api/contract';
import { useExpenses } from '../../contexts/ExpensesContext';
import { fileNameFor, MAX_RECEIPT_FILES, toJpeg, uploadToS3, type ReceiptPhoto } from '../../expenses/receipts';
import { NavHeader } from '../NavHeader';
import { Button } from '../ui/Button';
import { Text } from '../ui/Text';

type Phase = 'review' | 'uploading';
type FileState = { status: 'waiting' | 'uploading' | 'done' | 'error'; error?: string };

let nextId = 0;

export function CaptureScreen({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  const { options, loadExpenses } = useExpenses();
  const [photos, setPhotos] = useState<ReceiptPhoto[]>([]);
  const [converting, setConverting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('review');
  const [files, setFiles] = useState<FileState[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const presigned = useRef<ExpenseUploadsResponse['uploads'] | null>(null);
  const started = useRef(false);
  const room = MAX_RECEIPT_FILES - photos.length;

  const addAssets = useCallback(async (assets: ImagePicker.ImagePickerAsset[]) => {
    setConverting(true);
    try {
      const converted: ReceiptPhoto[] = [];
      for (const asset of assets) {
        const jpeg = await toJpeg(asset);
        converted.push({ id: String(nextId++), ...jpeg });
      }
      setPhotos((prev) => [...prev, ...converted].slice(0, MAX_RECEIPT_FILES));
    } catch (err) {
      setNotice(errorMessage(err));
    } finally {
      setConverting(false);
    }
  }, []);

  const takePhoto = useCallback(async () => {
    setNotice(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setNotice('Allow camera access in Settings to photograph receipts.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!result.canceled) await addAssets(result.assets);
  }, [addAssets]);

  const chooseFromLibrary = async () => {
    setNotice(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: Math.max(room, 1),
      quality: 1,
    });
    if (!result.canceled) await addAssets(result.assets);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void takePhoto();
  }, [takePhoto]);

  const setFile = (index: number, next: FileState) => setFiles((prev) => prev.map((f, i) => (i === index ? next : f)));

  const run = async (list: ReceiptPhoto[], states: FileState[]) => {
    setCreateError(null);
    try {
      if (!presigned.current) {
        const res = await api.expenseUploads(list.map((_, i) => ({ contentType: 'image/jpeg', fileName: fileNameFor(i) })));
        presigned.current = res.uploads;
      }
      const uploads = presigned.current;
      for (let i = 0; i < list.length; i++) {
        if (states[i].status === 'done') continue;
        setFile(i, { status: 'uploading' });
        try {
          await uploadToS3(uploads[i], { uri: list[i].uri, fileName: fileNameFor(i) });
          states[i] = { status: 'done' };
          setFile(i, states[i]);
        } catch (err) {
          states[i] = { status: 'error', error: errorMessage(err) };
          setFile(i, states[i]);
        }
      }
      if (states.some((s) => s.status !== 'done')) return;
      setCreating(true);
      const prefill = options?.lastPaidWith;
      const expense = await api.createExpense({
        receiptKeys: uploads.map((u) => u.key),
        ...(prefill ? { paidWith: prefill.paidWith, ...(prefill.cardId ? { cardId: prefill.cardId } : {}) } : {}),
      });
      void loadExpenses();
      onCreated(expense.id);
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  };

  const start = () => {
    const states: FileState[] = photos.map(() => ({ status: 'waiting' }));
    presigned.current = null;
    setFiles(states);
    setPhase('uploading');
    void run(photos, states);
  };

  const retry = () => {
    const states = files.map((f) => (f.status === 'error' ? ({ status: 'waiting' } as FileState) : f));
    setFiles(states);
    void run(photos, states);
  };

  const remove = (id: string) => setPhotos((prev) => prev.filter((p) => p.id !== id));
  const doneCount = files.filter((f) => f.status === 'done').length;
  const busy = phase === 'uploading' && (creating || files.some((f) => f.status === 'uploading' || f.status === 'waiting'));
  const canRetry = phase === 'uploading' && !busy;

  if (phase === 'uploading') {
    return (
      <View style={tw`flex-1 bg-cool-white`}>
        <NavHeader title="Sending receipts" onBack={busy ? () => {} : () => setPhase('review')} />
        <ScrollView contentContainerStyle={tw`px-4 pt-4`}>
          <Text style={tw`text-sm text-slate-500`}>
            {creating ? 'Reading your receipts…' : `Uploaded ${doneCount} of ${photos.length}`}
          </Text>
          <View style={tw`mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white`}>
            {photos.map((p, i) => {
              const f = files[i] ?? { status: 'waiting' };
              return (
                <View key={p.id} style={[tw`flex-row items-center gap-3 px-3 py-2.5`, i > 0 && tw`border-t border-slate-100`]}>
                  <Image source={{ uri: p.uri }} style={tw`h-12 w-12 rounded-lg bg-slate-100`} />
                  <View style={tw`flex-1`}>
                    <Text style={tw`text-sm font-bold text-cool-black`}>Receipt {i + 1}</Text>
                    {f.error ? <Text style={tw`text-xs text-coral`}>{f.error}</Text> : null}
                  </View>
                  {f.status === 'done' ? <CheckCircle2 size={20} color={colors.green} /> : null}
                  {f.status === 'error' ? <AlertCircle size={20} color={colors.coral} /> : null}
                  {f.status === 'uploading' ? <ActivityIndicator size="small" color={colors.teal} /> : null}
                </View>
              );
            })}
          </View>
          {createError ? <Text style={tw`mt-3 text-sm text-coral`}>{createError}</Text> : null}
          {canRetry ? (
            <Button style={tw`mt-4`} onPress={retry}>
              {createError && files.every((f) => f.status === 'done') ? 'Try again' : 'Retry failed uploads'}
            </Button>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={tw`flex-1 bg-cool-white`}>
      <NavHeader title="Add receipt" subtitle={photos.length > 0 ? `${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : undefined} onBack={onBack} />
      <ScrollView contentContainerStyle={tw`px-4 pt-4`}>
        {photos.length === 0 ? (
          <View style={tw`items-center px-8 py-12`}>
            <Camera size={28} color={colors.slate400} />
            <Text style={tw`mt-2 font-bold text-cool-black`}>No photos yet</Text>
            <Text style={tw`mt-0.5 text-center text-sm text-slate-500`}>Photograph every page of the receipt, including the card slip.</Text>
          </View>
        ) : (
          <View style={tw`flex-row flex-wrap gap-3`}>
            {photos.map((p, i) => (
              <View key={p.id} style={tw`h-36 w-[30%] overflow-hidden rounded-xl bg-slate-100`}>
                <Image source={{ uri: p.uri }} accessibilityLabel={`Receipt photo ${i + 1}`} resizeMode="cover" style={tw`h-full w-full`} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove photo ${i + 1}`}
                  onPress={() => remove(p.id)}
                  hitSlop={6}
                  style={tw`absolute right-1 top-1 h-6 w-6 items-center justify-center rounded-full bg-cool-black/70`}>
                  <X size={14} color={colors.white} />
                </Pressable>
              </View>
            ))}
            {converting ? (
              <View style={tw`h-36 w-[30%] items-center justify-center rounded-xl bg-slate-100`}>
                <ActivityIndicator color={colors.teal} />
              </View>
            ) : null}
          </View>
        )}
        {notice ? <Text style={tw`mt-3 text-sm text-coral`}>{notice}</Text> : null}
        <View style={tw`mt-5 flex-row gap-2`}>
          <View style={tw`flex-1`}>
            <Button fullWidth variant="outline" color="navy" leftIcon={Camera} disabled={room <= 0 || converting} onPress={() => void takePhoto()}>
              {photos.length === 0 ? 'Take photo' : 'Take another'}
            </Button>
          </View>
          <View style={tw`flex-1`}>
            <Button fullWidth variant="outline" color="navy" leftIcon={Images} disabled={room <= 0 || converting} onPress={() => void chooseFromLibrary()}>
              Library
            </Button>
          </View>
        </View>
        {room <= 0 ? <Text style={tw`mt-2 text-xs text-slate-500`}>That’s the most you can add to one expense.</Text> : null}
      </ScrollView>
      <View style={[tw`border-t border-slate-200 bg-white px-4 pt-3`, { paddingBottom: 12 + insets.bottom }]}>
        <Button fullWidth size="lg" disabled={photos.length === 0 || converting} onPress={start}>
          Done
        </Button>
      </View>
    </View>
  );
}
