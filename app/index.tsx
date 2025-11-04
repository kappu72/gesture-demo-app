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
}

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

const events: EventCard[] = Array.from({ length: 10 }, (_, i) => ({
  id: i.toString(),
  title: `Evento ${i + 1}`,
}));

export default function Index() {
  const flatListRef = useRef<FlatList>(null);
  const currentIndexRef = useRef(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const { width: windowWidth } = useWindowDimensions();
  const baseOffsetRef = useRef(0); // offset di partenza quando inizi il gesto

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
      <FlatList
        ref={flatListRef}
        data={events}
        renderItem={renderCard}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        getItemLayout={getItemLayout}
        initialScrollIndex={0}
        onScrollToIndexFailed={(info) => {
          const wait = new Promise((resolve) => setTimeout(resolve, 500));
          wait.then(() => {
            flatListRef.current?.scrollToIndex({
              index: info.index,
              animated: true,
            });
          });
        }}
      />
      
      <View style={styles.gestureContainer}>
        <CircleGestureDetector
          size={120}
          minRadiusRatio={0.5}
          maxRadiusRatio={0.9}
          turnThreshold={0.1}
          onGestureStart={() => {
            // Salva l'offset corrente come base
            baseOffsetRef.current = currentIndexRef.current * windowWidth;
          }}
        onRotationChange={(turns, direction, speedMultiplier) => {
          
          // Scroll con dampening: quando acceleri, viene rallentato
          // 1 giro completo = 1 card, ma con moltiplicatore che rallenta se vai veloce
          const scrollAmount = Math.abs(turns) * windowWidth * speedMultiplier;
          
          let offset;
          if (direction === 'counterclockwise') {
            // Antiorario: avanti
            offset = baseOffsetRef.current + scrollAmount;
          } else {
            // Orario: indietro
            offset = baseOffsetRef.current - scrollAmount;
          }
          
          // Scroll fluido con dampening automatico
          scrollToOffset(offset);
        }}
          onGestureEnd={() => {
            // Quando finisce il gesto, fai snap alla card più vicina
            snapToNearestCard();
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
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    height: "80%",
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
  gestureContainer: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
