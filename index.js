const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys")

const P = require("pino")
const fs = require("fs")

// ==============================================
// CONFIG
// ==============================================

const config = {
  shop: "Bolen Ummi",
  owner: "6285783129201", // nomer dsni
  address: "Jl. Contoh No.1, Jambi",
  location: {
    lat: -1.6101,
    lng: 103.6131 // ambil dari gmaps
  }
}

// ==============================================
// DATABASE
// ==============================================

const DB = "./database.json"

function loadDB() {
  if (!fs.existsSync(DB)) {
    fs.writeFileSync(DB, JSON.stringify({
      menu: [
        { nama: "Bolen Pisang", harga: 12000, stok: 20 },
        { nama: "Bolen Coklat", harga: 15000, stok: 15 },
        { nama: "Bolen Keju", harga: 18000, stok: 10 }
      ]
    }, null, 2))
  }

  return JSON.parse(fs.readFileSync(DB))
}

function saveDB(data) {
  fs.writeFileSync(DB, JSON.stringify(data, null, 2))
}

// ==============================================
// START BOT
// ==============================================

async function startBot() {
  let db = loadDB()

  const { state, saveCreds } =
    await useMultiFileAuthState("./session")

  const { version } =
    await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: P({ level: "silent" })
  })

  // Pairing Code
  if (!sock.authState.creds.registered) {
    const code = await sock.requestPairingCode(config.owner)

    console.log(`
╔════════════════════╗
   PAIRING CODE BOT
      ${code}
╚════════════════════╝
`)
  }

  sock.ev.on("creds.update", saveCreds)

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log("✅ Bot Connected")
    }

    if (connection === "close") {
      const retry =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut

      if (retry) startBot()
    }
  })

  // ==========================================
  // MESSAGE HANDLER
  // ==========================================

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0]
    if (!m.message || m.key.fromMe) return

    const jid = m.key.remoteJid
    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      ""

    const body = text.trim()
    const cmd = body.toLowerCase()

    const reply = (txt) =>
      sock.sendMessage(jid, { text: txt }, { quoted: m })

    db = loadDB()

    // ======================================
    // BASIC MENU
    // ======================================

    if (cmd === ".ping") {
      return reply("🏓 Pong!\nServer hidup. Langka tapi nyata.")
    }

    if (cmd === ".stok") {
      let txt = "📦 *STOK TERSEDIA*\n\n"

      db.menu.forEach((v, i) => {
        txt += `${i + 1}. ${v.nama}\n   Stok: ${v.stok}\n\n`
      })

      return reply(txt)
    }

    if (cmd === ".alamat") {
      return sock.sendMessage(jid, {
        location: {
          degreesLatitude: config.location.lat,
          degreesLongitude: config.location.lng,
          name: config.shop,
          address: config.address
        }
      }, { quoted: m })
    }

    if (cmd === ".order") {
      return reply(`
📝 *FORMAT ORDER*

.order nama|produk|jumlah|catatan

Contoh:
.order Siti|Bolen Pisang|2|antar sore
`)
    }

    // ======================================
    // MENU LIST BUTTON / SLIDE
    // ======================================

    if (cmd === ".menu") {
      let sections = db.menu.map((item) => ({
        title: item.nama,
        rows: [{
          title: `Rp${item.harga}`,
          description: `Stok: ${item.stok}`,
          rowId: `.order`
        }]
      }))

      return sock.sendMessage(jid, {
        text: `🥐 *${config.shop}*`,
        footer: "Pilih menu favoritmu.",
        title: "MENU BOLEN UMMI",
        buttonText: "📋 Lihat Menu",
        sections
      }, { quoted: m })
    }

    // ======================================
    // ORDER
    // ======================================

    if (cmd.startsWith(".order ")) {
      const data = body.slice(7).split("|")

      if (data.length < 4)
        return reply("Format salah.")

      const [nama, produk, jumlahTxt, note] = data

      const item = db.menu.find(
        x => x.nama.toLowerCase() === produk.toLowerCase()
      )

      if (!item)
        return reply("Produk tidak ditemukan.")

      const jumlah = parseInt(jumlahTxt)

      if (isNaN(jumlah) || jumlah < 1)
        return reply("Jumlah salah.")

      if (item.stok < jumlah)
        return reply("Stok habis.")

      item.stok -= jumlah
      saveDB(db)

      return reply(`
✅ *ORDER BERHASIL*

Nama: ${nama}
Produk: ${item.nama}
Jumlah: ${jumlah}
Catatan: ${note}

Total: Rp${item.harga * jumlah}
`)
    }

    // ======================================
    // ADD MENU
    // ======================================

    if (cmd.startsWith(".addmenu ")) {
      const data = body.slice(9).split("|")

      if (data.length < 3) {
        return reply(`
Format:
.addmenu nama|harga|stok

Contoh:
.addmenu Bolen Matcha|22000|10
`)
      }

      const nama = data[0].trim()
      const harga = parseInt(data[1])
      const stok = parseInt(data[2])

      db.menu.push({
        nama,
        harga,
        stok
      })

      saveDB(db)

      return reply(`✅ Menu ${nama} ditambahkan`)
    }

    // ======================================
    // EDIT STOK
    // ======================================

    if (cmd.startsWith(".setstok ")) {
      const data = body.slice(9).split("|")

      if (data.length < 2)
        return reply(`
Format:
.setstok nama|jumlah
`)

      const nama = data[0].trim()
      const stok = parseInt(data[1])

      const item = db.menu.find(
        x => x.nama.toLowerCase() === nama.toLowerCase()
      )

      if (!item)
        return reply("Menu tidak ditemukan.")

      item.stok = stok
      saveDB(db)

      return reply(`✅ Stok ${item.nama} jadi ${stok}`)
    }

    // ======================================
    // DELETE MENU
    // ======================================

    if (cmd.startsWith(".delmenu ")) {
      const nama = body.slice(9).trim()

      const index = db.menu.findIndex(
        x => x.nama.toLowerCase() === nama.toLowerCase()
      )

      if (index < 0)
        return reply("Menu tidak ditemukan.")

      const hapus = db.menu[index].nama

      db.menu.splice(index, 1)
      saveDB(db)

      return reply(`🗑️ ${hapus} dihapus`)
    }

  })
}

startBot()
