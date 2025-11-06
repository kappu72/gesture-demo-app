import React, { useCallback, useState } from 'react';
import { Animated, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
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
  onRotationChange?: (turns: number, direction: 'clockwise' | 'counterclockwise', speedMultiplier: number) => void; // speedMultiplier: 1 = lento, 2 = veloce
  onGestureStart?: () => void; // chiamato quando inizi il gesto
  onGestureEnd?: () => void; // chiamato quando finisce il gesto
  onPinchChange?: (scale: number) => void; // chiamato quando cambia il pinch (scale > 1 = allarga, < 1 = stringi)
};

const normalizeAngle = (a: number) => {
  'worklet';
  // Riporta l'angolo in [-π, π] in modo stabile
  const TWO_PI = Math.PI * 2;
  let x = ((a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;
  return x;
};

// Moltiplicatore fisso a 1x - scroll lineare senza accelerazione
const calculateSpeedMultiplier = (delta: number) => {
  'worklet';
  if (delta < 0.3) return 1

  return 1.2;
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
  onPinchChange,
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
  const lastReportedAngle = useSharedValue<number>(0); // per filtrare report troppo frequenti
  
  // Per velocità angolare smoothed
  const angularVelocity = useSharedValue<number>(0); // rad per update
  const lastUpdateTime = useSharedValue<number>(0);
  const lastDirection = useSharedValue<string>(''); // per rilevare inversione
  const lastRadius = useSharedValue<number>(0); // per rilevare movimenti circolari

  const resetStats = () => {
    'worklet';
    totalAngle.value = 0;
    samples.value = 0;
    radiusMean.value = 0;
    radiusM2.value = 0;
    isInsideBand.value = false;
    lastReportedTurn.value = 0;
    lastReportedAngle.value = 0;
    angularVelocity.value = 0;
    lastUpdateTime.value = 0;
    lastDirection.value = '';
    lastRadius.value = 0;
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    // Il centro deve essere al centro del cerchio nero visibile (size),
    // non al centro dell'area verde grande
    centerX.value = width / 2;
    centerY.value = height / 2;
    centerR.value = size / 2; // Raggio basato sul cerchio nero, non sul container
  };

  const report = useCallback((res: CircleResult) => {
    setLabel(
      `${res.direction === 'clockwise' ? 'Orario' : 'Antiorario'} • ${Math.abs(res.turns).toFixed(2)} giri`
    );
    onCircle?.(res);
  }, [onCircle]);

  const reportChange = useCallback((turns: number, direction: 'clockwise' | 'counterclockwise', speedMultiplier: number) => {
    onRotationChange?.(turns, direction, speedMultiplier);
  }, [onRotationChange]);

  const reportGestureStart = useCallback(() => {
    onGestureStart?.();
  }, [onGestureStart]);

  const reportGestureEnd = useCallback(() => {
    onGestureEnd?.();
  }, [onGestureEnd]);

  const reportPinchChange = useCallback((scale: number) => {
    onPinchChange?.(scale);
  }, [onPinchChange]);

  // Gesto Pinch per controllare i km
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      // scale: > 1 = allarga, < 1 = stringi
      runOnJS(reportPinchChange)(e.scale);
    });

  // Gesture Pan per rotazione (solo 1 dito)
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
      
      // FILTRO: ignora movimenti troppo vicini al centro
      if (r < R * 0.05) return;
      
      const a = Math.atan2(dy, dx);
      
      // Calcola delta angolare prima dei filtri
      let d = a - prevAngle.value;
      d = normalizeAngle(d);
      
      // FILTRO MOLTO FORTE: ignora movimenti quasi lineari
      // Solo movimenti chiaramente circolari vengono accettati
      if (lastRadius.value > 0) {
        const angleChangeMagnitude = Math.abs(d);
        
        // SOGLIA MINIMA: l'angolo deve cambiare di almeno 0.05 rad (~2.86°)
        // Questo elimina tutti i movimenti quasi-lineari
        if (angleChangeMagnitude < 0.05) {
          lastRadius.value = r;
          prevAngle.value = a;
          return;
        }
      }
      lastRadius.value = r;

      // Rimuovo temporaneamente il controllo delle band per debug
      // const minR = R * minRadiusRatio;
      // const maxR = R * maxRadiusRatio;
      // const inside = r >= minR && r <= maxR;
      // if (inside) isInsideBand.value = true;
      
      // Segna sempre come valido
      isInsideBand.value = true;
      
      // varianza r (Welford) per "circolarità"
      const n = (samples.value += 1);
      const delta = r - radiusMean.value;
      radiusMean.value += delta / n;
      const delta2 = r - radiusMean.value;
      radiusM2.value += delta * delta2;

      // CALCOLA VELOCITÀ ANGOLARE SMOOTHED con EMA
      // Smoothing factor: più alto = più reattivo, più basso = più smooth
      const alpha = 0.4;
      angularVelocity.value = alpha * d + (1 - alpha) * angularVelocity.value;
      
      // Direzione basata sul segno della velocità smoothed
      const currentDirection = angularVelocity.value < 0 ? 'clockwise' : 'counterclockwise';
      
      // RILEVA INVERSIONE DI DIREZIONE
      if (lastDirection.value !== '' && lastDirection.value !== currentDirection) {
        // Inversione! Reset totalAngle per evitare salti
        totalAngle.value = 0;
        console.log('Inversione direzione rilevata!');
      }
      lastDirection.value = currentDirection;
      
      // INTEGRA la velocità per ottenere la rotazione discretizzata
      // Invece di usare l'angolo reale, usiamo la velocità smoothed
      const discreteRotation = angularVelocity.value;
      
      totalAngle.value += discreteRotation; // Accumula velocità invece di angolo grezzo
      prevAngle.value = a;

      // VELOCITÀ sempre a 1 per scroll lineare e fluido
      const speedMultiplier = 1;

      // Report continuo con la velocità smoothed
      const TWO_PI = Math.PI * 2;
      const currentTurns = totalAngle.value / TWO_PI;
      
      runOnJS(reportChange)(currentTurns, currentDirection, speedMultiplier);

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

  // Combina Pan e Pinch - possono funzionare simultaneamente
  const composed = Gesture.Simultaneous(pan, pinch);

  return (
    <GestureDetector gesture={composed}>
      <Animated.View 
        onLayout={onLayout}
        style={{ 
          width: '100%', 
          height: '100%', 
          backgroundColor: 'rgba(0, 255, 0, 0.3)', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}
      >
        <View
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
      </Animated.View>
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
