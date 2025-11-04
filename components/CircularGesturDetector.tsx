import React, { useCallback, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

type CircleResult = {
  turns: number; // numero di giri (positivo anti-orario, negativo orario)
  direction: 'clockwise' | 'counterclockwise';
};

type Props = {
  size?: number;                     // diametro del pad
  minRadiusRatio?: number;           // fascia minima raggio (in % del raggio max)
  maxRadiusRatio?: number;           // fascia massima raggio
  turnThreshold?: number;            // giri minimi per considerare "cerchio"
  onCircle?: (res: CircleResult) => void;
  onRotationChange?: (turns: number, direction: 'clockwise' | 'counterclockwise') => void; // chiamato in tempo reale
  onGestureStart?: () => void; // chiamato quando inizi il gesto
  onGestureEnd?: () => void; // chiamato quando finisce il gesto
};

const normalizeAngle = (a: number) => {
  'worklet';
  // Riporta l'angolo in [-π, π] in modo stabile
  const TWO_PI = Math.PI * 2;
  let x = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return x;
};

export default function CircleGestureDetector({
  size = 280,
  minRadiusRatio = 0.45,   // 45% del raggio
  maxRadiusRatio = 0.85,   // 85% del raggio
  turnThreshold = 1.0,     // almeno 1 giro
  onCircle,
  onRotationChange,
  onGestureStart,
  onGestureEnd,
}: Props) {
  const [label, setLabel] = useState<string>('Fai un cerchio con un dito');
  
  // Shared values per il calcolo in worklet - ANCHE center deve essere shared!
  const centerX = useSharedValue<number>(size / 2);
  const centerY = useSharedValue<number>(size / 2);
  const centerR = useSharedValue<number>(size / 2);
  
  const prevAngle = useSharedValue<number>(0);
  const totalAngle = useSharedValue<number>(0);
  const samples = useSharedValue<number>(0);
  const radiusMean = useSharedValue<number>(0);
  const radiusM2 = useSharedValue<number>(0); // per varianza (Welford)
  const isInsideBand = useSharedValue<boolean>(false);
  const lastReportedTurn = useSharedValue<number>(0); // per tracciare i giri già segnalati

  const resetStats = () => {
    'worklet';
    totalAngle.value = 0;
    samples.value = 0;
    radiusMean.value = 0;
    radiusM2.value = 0;
    isInsideBand.value = false;
    lastReportedTurn.value = 0;
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const s = Math.min(width, height);
    centerX.value = s / 2;
    centerY.value = s / 2;
    centerR.value = s / 2;
  };

  const report = useCallback((res: CircleResult) => {
    setLabel(
      `${res.direction === 'clockwise' ? 'Orario' : 'Antiorario'} • ${Math.abs(res.turns).toFixed(2)} giri`
    );
    onCircle?.(res);
  }, [onCircle]);

  const reportChange = useCallback((turns: number, direction: 'clockwise' | 'counterclockwise') => {
    onRotationChange?.(turns, direction);
  }, [onRotationChange]);

  const reportGestureStart = useCallback(() => {
    onGestureStart?.();
  }, [onGestureStart]);

  const reportGestureEnd = useCallback(() => {
    onGestureEnd?.();
  }, [onGestureEnd]);

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(1)
    .onBegin((e) => {
      // Notifica inizio gesto
      runOnJS(reportGestureStart)();
      
      // Angolo iniziale
      const cx = centerX.value;
      const cy = centerY.value;
      const dx = e.x - cx;
      const dy = e.y - cy;
      const a = Math.atan2(dy, dx);
      prevAngle.value = a;
      // reset
      totalAngle.value = 0;
      samples.value = 0;
      radiusMean.value = 0;
      radiusM2.value = 0;
      isInsideBand.value = false;
    })
    .onUpdate((e) => {
      const cx = centerX.value;
      const cy = centerY.value;
      const R = centerR.value;

      const dx = e.x - cx;
      const dy = e.y - cy;
      // raggio e angolo correnti
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);

      // aggiorna band di validità: tra min/max percentuale del raggio massimo
      const minR = R * minRadiusRatio;
      const maxR = R * maxRadiusRatio;
      const inside = r >= minR && r <= maxR;
      if (inside) isInsideBand.value = true;
      
      // varianza r (Welford) per "circolarità"
      const n = (samples.value += 1);
      const delta = r - radiusMean.value;
      radiusMean.value += delta / n;
      const delta2 = r - radiusMean.value;
      radiusM2.value += delta * delta2;

      // delta angolare con wrap-correction
      let d = a - prevAngle.value;
      d = normalizeAngle(d);
      
      // ignora micro-movimenti rumorosi
      if (Math.abs(d) < 0.004) return;

      totalAngle.value += d;
      prevAngle.value = a;

      // Report in tempo reale
      const TWO_PI = Math.PI * 2;
      const currentTurns = totalAngle.value / TWO_PI;
      const currentDirection = totalAngle.value < 0 ? 'clockwise' : 'counterclockwise';
      runOnJS(reportChange)(currentTurns, currentDirection);

      // Controlla se abbiamo completato un nuovo giro completo
      const currentFullTurns = Math.floor(Math.abs(currentTurns));
      const lastFullTurns = Math.floor(Math.abs(lastReportedTurn.value));
      
      if (currentFullTurns > lastFullTurns && currentFullTurns >= turnThreshold) {
        // Abbiamo completato un nuovo giro!
        lastReportedTurn.value = currentTurns;
        runOnJS(report)({ turns: currentTurns, direction: currentDirection });
      }
    })
    .onEnd(() => {
      const TWO_PI = Math.PI * 2;
      const turns = totalAngle.value / TWO_PI;

      // stima varianza del raggio (se samples < 2, var = 0)
      const varR = samples.value > 1 ? radiusM2.value / (samples.value - 1) : 0;

      // criteri di validazione:
      // 1) almeno una volta è stato "dentro" la fascia di raggio
      // 2) |turns| sopra soglia
      // 3) r stabile (varianza non troppo alta rispetto al raggio)
      const okBand = isInsideBand.value;
      const okTurns = Math.abs(turns) >= turnThreshold;
      const okVariance = varR <= (centerR.value * 0.15) ** 2; // soglia empirica

      if (okBand && okTurns && okVariance) {
        const direction = turns < 0 ? 'clockwise' : 'counterclockwise';
        // Nota: su schermo y cresce verso il basso; con la definizione atan2,
        // d < 0 tende ad indicare movimento orario.
        runOnJS(report)({ turns, direction });
      }

      // Notifica fine gesto (per snap)
      runOnJS(reportGestureEnd)();

      // pronto per il prossimo
      resetStats();
    })
    .onFinalize(() => {
      // in caso di cancel, reset
      runOnJS(reportGestureEnd)();
      resetStats();
    });

  return (
    <GestureDetector gesture={pan}>
      <View
        onLayout={onLayout}
        style={[styles.pad, { width: size, height: size, borderRadius: size / 2 }]}
      >
        {/* Anello guida */}
        <View
          style={[
            styles.ring,
            {
              width: size * 0.9,
              height: size * 0.9,
              borderRadius: (size * 0.9) / 2,
            },
          ]}
        />
        <Text style={styles.label}>{label}</Text>
        <View
          pointerEvents="none"
          style={[
            styles.band,
            {
              width: size * (2 * 0.65), // illustrativo visivo ~ banda centrale
              height: size * (2 * 0.65),
              borderRadius: size * 0.65,
            },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  pad: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0c0c0f',
    borderWidth: 2,
    borderColor: '#2a2a33',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#4b4b5c',
  },
  band: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#343445',
    opacity: 0.25,
  },
  label: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
