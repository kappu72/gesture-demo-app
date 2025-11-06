import { memo, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import CircleGestureDetector from "../components/CircularGesturDetector";

interface EventCard {
  id: string;
  title: string;
  distance: string;
  type: string;
  date: string;
}

// Componente Tag per i badge sopra la card
const EventTag = memo(({ label, icon }: { label: string; icon?: string }) => (
  <View style={styles.tag}>
    {icon && <Text style={styles.tagIcon}>{icon}</Text>}
    <Text style={styles.tagText} numberOfLines={1}>{label}</Text>
  </View>
));

// Prevent re-render
EventTag.displayName = 'EventTag';

// Componente Card puro che non si re-renderizza
const EventCardComponent = memo(({ item, width }: { item: EventCard; width: number }) => {
  console.log(`Rendering card: ${item.title}`);
  
  return (
    <View style={[styles.cardContainer, { width }]}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardSubtitle}>Swipe with rotation gesture</Text>
      </View>
    </View>
  );
});

const eventTypes = ['Aperitivo', 'Concerto', 'Teatro', 'Mostra', 'Cinema', 'Club'];
const events: EventCard[] = Array.from({ length: 10 }, (_, i) => ({
  id: i.toString(),
  title: `Evento ${i + 1}`,
  distance: `${(Math.random() * 10 + 0.5).toFixed(1)} km`,
  type: eventTypes[i % eventTypes.length],
  date: new Date(Date.now() + i * 86400000).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
}));

export default function Index() {
  const flatListRef = useRef<FlatList>(null);
  const currentIndexRef = useRef(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const baseOffsetRef = useRef(0); // offset di partenza quando inizi il gesto
  const lastDirectionRef = useRef<string>(''); // per rilevare inversioni
  
  // Stato per il filtro distanza (km)
  const [distanceKm, setDistanceKm] = useState(5.0);
  const basePinchScaleRef = useRef(1);
  const baseDistanceRef = useRef(5.0);

  const scrollToOffset = (offset: number, animated: boolean = false) => {
    const maxOffset = windowWidth * (events.length - 1);
    const clampedOffset = Math.max(0, Math.min(maxOffset, offset));
    
    flatListRef.current?.scrollToOffset({
      offset: clampedOffset,
      animated: animated,
    });
    
    // Aggiorna l'indice corrente
    const newIndex = Math.round(clampedOffset / windowWidth);
    if (newIndex !== currentIndexRef.current) {
      currentIndexRef.current = newIndex;
      setCurrentIndex(newIndex);
    }
  };

  const snapToNearestCard = () => {
    // Trova la card più vicina e fai snap con animazione
    const nearestIndex = currentIndexRef.current;
    const snapOffset = nearestIndex * windowWidth;
    scrollToOffset(snapOffset, true);
  };

  const renderCard = ({ item }: { item: EventCard }) => {
    return <EventCardComponent item={item} width={windowWidth} />;
  };

  const getItemLayout = (_: any, index: number) => ({
    length: windowWidth,
    offset: windowWidth * index,
    index,
  });

  return (
    <View style={styles.container}>
      {/* Tag fissi sopra la FlatList - 10px di margine sotto */}
      <View style={styles.tagsContainer}>
        <EventTag label={`${distanceKm.toFixed(1)} km`} icon="📍" />
        <EventTag label="Aperitivo" icon="🎉" />
        <EventTag label="05 nov" icon="📅" />
      </View>

      <FlatList
        ref={flatListRef}
        data={events}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled={false}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialScrollIndex={0}
        decelerationRate="normal"
        disableIntervalMomentum={true}
      />
      
      <View style={styles.gestureContainer}>
        <CircleGestureDetector
          size={120}
          minRadiusRatio={0.5}
          maxRadiusRatio={0.9}
          turnThreshold={0.1}
          onGestureStart={() => {
            // Salva l'offset corrente come base per rotazione
            baseOffsetRef.current = currentIndexRef.current * windowWidth;
            lastDirectionRef.current = ''; // Reset direzione
            // Salva distanza corrente come base per pinch
            baseDistanceRef.current = distanceKm;
            basePinchScaleRef.current = 1;
          }}
        onRotationChange={(turns, direction, speedMultiplier) => {
          
          // RILEVA INVERSIONE DI DIREZIONE
          if (lastDirectionRef.current !== '' && lastDirectionRef.current !== direction) {
            // Inversione! Resetta la base all'offset corrente
            baseOffsetRef.current = currentIndexRef.current * windowWidth;
            console.log('Inversione! Reset base a:', baseOffsetRef.current);
          }
          lastDirectionRef.current = direction;
          
          // Scroll con velocità smoothed
          const scrollAmount = Math.abs(turns) * windowWidth * speedMultiplier;
          
          let offset;
          if (direction === 'counterclockwise') {
            // Antiorario: avanti
            offset = baseOffsetRef.current + scrollAmount;
          } else {
            // Orario: indietro
            offset = baseOffsetRef.current - scrollAmount;
          }
          
          // Scroll fluido
          scrollToOffset(offset);
        }}
          onGestureEnd={() => {
            // Quando finisce il gesto, fai snap alla card più vicina
            snapToNearestCard();
          }}
          onPinchChange={(scale) => {
            // Calcola nuova distanza basata sul pinch
            // scale > 1 = allarga = aumenta km
            // scale < 1 = stringi = diminuisci km
            // Range: 0.5 km - 50 km
            const newDistance = baseDistanceRef.current * scale;
            const clampedDistance = Math.max(0.5, Math.min(50, newDistance));
            setDistanceKm(clampedDistance);
          }}
          onCircle={(res) => {
            
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#e0e0e0",
  },
  cardContainer: {
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 20,
  },
  card: {
    width: "100%",
    height: "60%",
    backgroundColor: "#fff",
    borderRadius: 20,
    borderWidth: 3,
    borderColor: "#333",
    justifyContent: "center",
    alignItems: "center",
    padding: 30,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  cardTitle: {
    fontSize: 48,
    fontWeight: "bold",
    color: "#333",
    marginBottom: 10,
  },
  cardSubtitle: {
    fontSize: 16,
    color: "#666",
    textAlign: "center",
  },
  tagsContainer: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 30,
    paddingBottom: 0,
    gap: 10,
    backgroundColor: "#e0e0e0",
  },
  tag: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
  },
  tagIcon: {
    fontSize: 14,
  },
  tagText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
  gestureContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 300,
    alignItems: "center",
    justifyContent: "center",
  },
});
