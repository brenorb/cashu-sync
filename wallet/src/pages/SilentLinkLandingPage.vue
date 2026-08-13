<template>
  <main class="landing">
    <section class="landing-hero" aria-labelledby="landing-title">
      <div class="landing-kicker">
        <span class="signal-dot"></span> Silent Link / Madeira
      </div>
      <h1 id="landing-title">Connectivity that<br /><em>keeps moving.</em></h1>
      <p class="landing-lede">
        Buy an eSIM, top up in seconds, and keep your credits in a wallet you
        control across every device.
      </p>
      <div class="landing-actions">
        <q-btn
          data-landing-action="buy-esim"
          color="primary"
          unelevated
          no-caps
          label="Buy an eSIM"
          @click="showEsimDialog = true"
        />
        <q-btn
          data-landing-action="top-up"
          class="landing-outline"
          outline
          no-caps
          label="Top up with Lightning"
          @click="openTopUp"
        />
      </div>
    </section>

    <section class="landing-grid" aria-label="Silent Link features">
      <article class="landing-card landing-card--wide">
        <span class="card-index">01 / CONNECT</span>
        <h2>One link. Anywhere.</h2>
        <p>Instant eSIM access with a wallet that travels with you.</p>
        <span class="card-mark">↗</span>
      </article>
      <article class="landing-card">
        <span class="card-index">02 / CONTROL</span>
        <h2>Your credits.</h2>
        <p>Lightning in. Cashu balance out. No account hand-off.</p>
      </article>
      <article class="landing-card landing-card--accent">
        <span class="card-index">03 / SYNC</span>
        <h2>Every screen agrees.</h2>
        <p>Pair a second wallet and watch the same balance follow.</p>
      </article>
    </section>

    <footer class="landing-footer">
      <span>silent.link</span>
      <router-link to="/wallet"
        >Open wallet <span aria-hidden="true">→</span></router-link
      >
    </footer>

    <q-dialog v-model="showEsimDialog">
      <q-card class="landing-dialog">
        <q-card-section>
          <span class="card-index">SILENT LINK ESIM</span>
          <h2>Stay connected.</h2>
          <p>
            Start with a Lightning top-up. Your funded wallet is ready when you
            are.
          </p>
          <div class="esim-plan">
            <strong>Travel data</strong><span>from $5.00</span>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat no-caps label="Not now" v-close-popup />
          <q-btn
            color="primary"
            unelevated
            no-caps
            label="Top up now"
            @click="openTopUp"
          />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </main>
</template>

<script lang="ts">
import { defineComponent } from "vue";

export default defineComponent({
  name: "SilentLinkLandingPage",
  data() {
    return { showEsimDialog: false };
  },
  methods: {
    openTopUp() {
      this.showEsimDialog = false;
      void this.$router.push({ path: "/wallet", query: { topup: "1" } });
    },
  },
});
</script>

<style scoped lang="scss">
.landing {
  width: min(100%, 1120px);
  min-height: calc(100vh - 64px);
  margin: 0 auto;
  padding: clamp(32px, 8vw, 88px) clamp(18px, 5vw, 64px) 28px;
  background: radial-gradient(circle at 82% 10%, #332000 0, transparent 28%),
    #090909;
}

.landing-hero {
  max-width: 760px;
}
.landing-kicker,
.card-index {
  color: var(--sl-orange);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.signal-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 8px;
  background: var(--sl-orange);
  border-radius: 50%;
  box-shadow: 0 0 14px var(--sl-orange);
}
.landing h1 {
  margin: 22px 0 20px;
  font-size: clamp(3.3rem, 11vw, 7.6rem);
  font-weight: 700;
  letter-spacing: -0.075em;
  line-height: 0.88;
}
.landing h1 em {
  color: var(--sl-orange);
  font-style: normal;
}
.landing-lede {
  max-width: 40ch;
  margin: 0;
  color: #a9a9a9;
  font-size: clamp(1rem, 2vw, 1.25rem);
  line-height: 1.45;
}
.landing-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 32px;
}
.landing-actions :deep(.q-btn) {
  min-height: 50px;
  padding-inline: 22px;
  border-radius: 3px;
  font-weight: 700;
}
.landing-outline {
  color: #fff !important;
  border-color: #656565 !important;
}
.landing-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-top: clamp(56px, 10vw, 120px);
}
.landing-card {
  position: relative;
  min-height: 190px;
  border: 1px solid #303030;
  padding: 22px;
  background: #111;
}
.landing-card--wide {
  grid-column: span 2;
  min-height: 230px;
  background: linear-gradient(120deg, #171717, #0d0d0d);
}
.landing-card--accent {
  border-color: #6f4700;
  background: #211600;
}
.landing-card h2 {
  max-width: 12ch;
  margin: 28px 0 8px;
  color: #fff;
  font-size: clamp(1.35rem, 3vw, 2rem);
  letter-spacing: -0.04em;
}
.landing-card p {
  max-width: 28ch;
  margin: 0;
  color: #a7a7a7;
  line-height: 1.45;
}
.card-mark {
  position: absolute;
  right: 22px;
  bottom: 14px;
  color: var(--sl-orange);
  font-size: 3rem;
}
.landing-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 52px;
  color: #7e7e7e;
  font-size: 0.85rem;
}
.landing-footer a {
  color: #fff;
  text-decoration: none;
}
.landing-dialog {
  width: min(92vw, 480px);
  border: 1px solid #5c3e0b;
  background: #151515;
  color: #fff;
}
.landing-dialog h2 {
  margin: 20px 0 8px;
  font-size: 2rem;
}
.landing-dialog p {
  color: #a9a9a9;
  line-height: 1.45;
}
.esim-plan {
  display: flex;
  justify-content: space-between;
  border: 1px solid #343434;
  margin-top: 22px;
  padding: 14px;
}
.esim-plan span {
  color: var(--sl-orange);
}
@media (max-width: 600px) {
  .landing-grid {
    grid-template-columns: 1fr;
  }
  .landing-card--wide {
    grid-column: auto;
  }
}
</style>
