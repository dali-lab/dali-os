import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Rect } from 'react-native-svg';
import { generateTiles, seededRandom, type Tile } from './tiles';

type Animation = 'none' | 'pop' | 'wave' | 'shuffle';

interface TilePatternProps {
  rows?: number;
  columns?: number;
  tileSize?: number;
  seed?: number;
  density?: number;
  layout?: 'cluster' | 'grid';
  /** Cover the parent, cropping like `xMidYMid slice` */
  fill?: boolean;
  animation?: Animation;
  speed?: number;
  style?: ViewStyle;
}

export function TilePattern({
  rows = 4,
  columns = 8,
  tileSize = 48,
  seed = 7,
  density = 0.65,
  layout = 'cluster',
  fill = false,
  animation = 'none',
  speed = 1,
  style,
}: TilePatternProps) {
  const base = useMemo(() => generateTiles({ rows, columns, seed, layout, density }), [rows, columns, seed, layout, density]);
  const [tiles, setTiles] = useState(base);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => setTiles(base), [base]);

  useEffect(() => {
    if (animation !== 'shuffle') return;
    let tick = 0;
    const id = setInterval(() => {
      tick += 1;
      const next = generateTiles({ rows, columns, seed: seed + tick * 7919, layout, density });
      const rand = seededRandom(seed * 31 + tick);
      setTiles((prev) => prev.map((t, i) => (rand() < 0.3 ? next[i] : t)));
    }, 2200 / Math.max(0.1, speed));
    return () => clearInterval(id);
  }, [animation, speed, rows, columns, seed, layout, density]);

  const size = fill && box ? Math.max(box.w / columns, box.h / rows) : tileSize;
  const gridW = size * columns;
  const gridH = size * rows;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setBox((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
  };

  const grid = (
    <View style={{ width: gridW, height: gridH, flexDirection: 'row', flexWrap: 'wrap' }}>
      {tiles.slice(0, rows * columns).map((tile, i) => {
        const row = Math.floor(i / columns);
        const col = i % columns;
        return (
          <View key={i} style={{ width: size, height: size }}>
            {tile ? (
              <AnimatedTile key={tileKey(tile)} tile={tile} size={size} index={i} row={row} col={col} animation={animation} speed={speed} />
            ) : null}
          </View>
        );
      })}
    </View>
  );

  if (!fill) return <View pointerEvents="none" style={style}>{grid}</View>;
  return (
    <View pointerEvents="none" onLayout={onLayout} style={[{ flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {box ? grid : null}
    </View>
  );
}

function tileKey(t: Tile) {
  return `${t.shape}-${t.background}-${t.foreground}-${t.rotation}`;
}

function AnimatedTile({
  tile,
  size,
  index,
  row,
  col,
  animation,
  speed,
}: {
  tile: Tile;
  size: number;
  index: number;
  row: number;
  col: number;
  animation: Animation;
  speed: number;
}) {
  const enter = useRef(new Animated.Value(animation === 'pop' || animation === 'shuffle' ? 0 : 1)).current;
  const wave = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (animation === 'pop' || animation === 'shuffle') {
      const jitter = ((index * 37) % 11) / 11;
      Animated.spring(enter, {
        toValue: 1,
        stiffness: animation === 'pop' ? 380 : 420,
        damping: animation === 'pop' ? 22 : 24,
        delay: animation === 'pop' ? (((row + col) * 0.06 + jitter * 0.08) / speed) * 1000 : 0,
        useNativeDriver: true,
      }).start();
    }
    if (animation === 'wave') {
      const half = (1200 / speed);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(wave, { toValue: 0.62, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(wave, { toValue: 1, duration: half, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      );
      const start = setTimeout(() => loop.start(), (((row + col) * 0.14) / speed) * 1000);
      return () => {
        clearTimeout(start);
        loop.stop();
      };
    }
  }, [animation, enter, wave, index, row, col, speed]);

  const framed = tile.shape !== 'loose' && tile.shape !== 'quarter' && tile.shape !== 'half';
  return (
    <Animated.View style={{ width: size, height: size, opacity: enter, transform: [{ scale: enter }] }}>
      {framed ? <View style={{ position: 'absolute', width: size, height: size, backgroundColor: tile.background }} /> : null}
      <Animated.View style={{ width: size, height: size, transform: [{ rotate: `${tile.rotation}deg` }, { scale: wave }] }}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <TileShapeSvg tile={tile} />
        </Svg>
      </Animated.View>
    </Animated.View>
  );
}

function TileShapeSvg({ tile }: { tile: Tile }) {
  const { shape, foreground: fg, background: bg } = tile;
  switch (shape) {
    case 'dot':
      return <Circle cx={50} cy={50} r={25} fill={fg} />;
    case 'ring':
      return (
        <G>
          <Circle cx={50} cy={50} r={27} fill={fg} />
          <Circle cx={50} cy={50} r={12} fill={bg} />
        </G>
      );
    case 'flower':
      return (
        <G fill={fg}>
          <Ellipse cx={50} cy={30} rx={11} ry={18} />
          <Ellipse cx={50} cy={70} rx={11} ry={18} />
          <Ellipse cx={30} cy={50} rx={18} ry={11} />
          <Ellipse cx={70} cy={50} rx={18} ry={11} />
        </G>
      );
    case 'asterisk':
      return (
        <G stroke={fg} strokeWidth={6} strokeLinecap="round">
          <Line x1={50} y1={24} x2={50} y2={76} />
          <Line x1={24} y1={50} x2={76} y2={50} />
          <Line x1={32} y1={32} x2={68} y2={68} />
          <Line x1={68} y1={32} x2={32} y2={68} />
        </G>
      );
    case 'quarter':
      return <Path d="M0 100 V0 A100 100 0 0 1 100 100 Z" fill={bg} />;
    case 'half':
      return <Path d="M0 100 A50 50 0 0 1 100 100 Z" fill={bg} />;
    case 'loose':
      return <Circle cx={50} cy={50} r={20} fill={fg} />;
    default:
      return <Rect width={100} height={100} fill="transparent" />;
  }
}
