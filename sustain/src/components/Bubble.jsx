import styles from "./Bubble.module.css";

export default function Bubble({ point }) {
  const co2Avoided = point?.infos?.[0]?.co2 ?? 0;

  return (
    <div className={styles.bubble}>
      <div className={styles.icon}>🌱</div>
      <div className={styles.value}>{co2Avoided} kg</div>
    </div>
  );
}
