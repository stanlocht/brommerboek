"""Seed data for Brommerboek — a sample Honda Super Cub 50 trip.

Amsterdam → Cinque Terre, 1.024 km across five countries (NL → BE → FR → CH →
IT) with two repair stops. The design prototype used abstract SVG coordinates;
here every stop carries its real latitude/longitude so it can be pinned on a
real map. All journal copy is Dutch, matching the design.
"""

from datetime import date

from sqlmodel import Session, func, select

from app import crud
from app.models import MediaItem, Stop, StopCreate

# Each entry mirrors the design's seed stop, with real coordinates substituted
# for the prototype's drawing coordinates.
TRIP: list[StopCreate] = [
    StopCreate(
        place="Amsterdam",
        country="Nederland",
        code="NL",
        lat=52.3676,
        lng=4.9041,
        date=date(2024, 5, 4),
        title="Vertrek",
        km=0,
        weather="Grijs, 14°",
        type="stop",
        story=(
            "Om zes uur ’s ochtends de gracht uit, met alles ingepakt op het "
            "rekje achterop. De Cub pruttelt nog wat koud, maar we rijden. "
            "Vandaag begint de tocht die ik al twee jaar op de keukenkalender "
            "heb staan."
        ),
        media=[
            MediaItem(tone="#c9a24e", cap="Vertrek · 06:12"),
            MediaItem(tone="#6d7f8f", cap="Grachten"),
            MediaItem(tone="#94a06a", cap="Eerste km"),
        ],
    ),
    StopCreate(
        place="Rotterdam",
        country="Nederland",
        code="NL",
        lat=51.9244,
        lng=4.4777,
        date=date(2024, 5, 5),
        title="Over de Maas",
        km=78,
        weather="Zon, 17°",
        type="stop",
        story=(
            "De Erasmusbrug in de ochtendmist. Een havenarbeider wees me "
            "lachend op mijn kenteken — “tot in Italië op dat ding?”. Ja, dat "
            "is het plan."
        ),
        media=[
            MediaItem(tone="#5f938f", cap="Erasmusbrug"),
            MediaItem(tone="#c9a24e", cap="De haven"),
        ],
    ),
    StopCreate(
        place="Antwerpen",
        country="België",
        code="BE",
        lat=51.2194,
        lng=4.4025,
        date=date(2024, 5, 6),
        title="De grens over",
        km=172,
        weather="Bewolkt, 16°",
        type="stop",
        story=(
            "Geen slagboom, geen stempel — alleen een blauw bord en opeens "
            "praat iedereen anders. Frietjes met stoofvlees als grensritueel."
        ),
        media=[
            MediaItem(tone="#9c4a3a", cap="Grote Markt"),
            MediaItem(tone="#6d7f8f", cap="Douane"),
        ],
    ),
    StopCreate(
        place="Gent",
        country="België",
        code="BE",
        lat=51.0543,
        lng=3.7174,
        date=date(2024, 5, 7),
        title="Graslei",
        km=230,
        weather="Regen, 13°",
        type="stop",
        story=(
            "Een dag schuilen voor de regen langs de Leie. De Cub stond te "
            "glimmen onder een luifel terwijl ik koffie na koffie dronk en "
            "kaarten uitspreidde."
        ),
        media=[
            MediaItem(tone="#94a06a", cap="Graslei"),
            MediaItem(tone="#b26a4c", cap="Frietkot", video=True),
        ],
    ),
    StopCreate(
        place="Reims",
        country="Frankrijk",
        code="FR",
        lat=49.2583,
        lng=4.0317,
        date=date(2024, 5, 9),
        title="Lekke band",
        km=388,
        weather="Zon, 19°",
        type="repair",
        broke=("Achterband lek — een spijker uit een wijngaardpad, 8 km voor Reims."),
        fixed=(
            "Band geplakt langs de kant, nieuwe binnenband uit de tas. Een uur "
            "werk en een fles water."
        ),
        story=(
            "Natuurlijk een lekke band in het land van de champagne. Ik heb hem "
            "geplakt in de berm terwijl een tractor voorbij tufte. Daarna ter "
            "viering toch maar een glas, ik had het verdiend."
        ),
        media=[
            MediaItem(tone="#9c4a3a", cap="Lekke band"),
            MediaItem(tone="#c9a24e", cap="Champagne"),
        ],
    ),
    StopCreate(
        place="Dijon",
        country="Frankrijk",
        code="FR",
        lat=47.3220,
        lng=5.0415,
        date=date(2024, 5, 11),
        title="Mosterd & wijn",
        km=512,
        weather="Zon, 22°",
        type="stop",
        story=(
            "Door de Route des Grands Crus, dorpje na dorpje met namen als op "
            "de etiketten thuis. De Cub houdt van deze rustige N-wegen, geen "
            "haast, geen snelweg."
        ),
        media=[
            MediaItem(tone="#94a06a", cap="Wijngaarden"),
            MediaItem(tone="#c9a24e", cap="Mosterd"),
            MediaItem(tone="#5f938f", cap="Route N74"),
        ],
    ),
    StopCreate(
        place="Lausanne",
        country="Zwitserland",
        code="CH",
        lat=46.5197,
        lng=6.6323,
        date=date(2024, 5, 13),
        title="Lac Léman",
        km=655,
        weather="Helder, 20°",
        type="stop",
        story=(
            "Het meer lag als een spiegel en de Alpen stonden er achter alsof "
            "ze op me wachtten. Ik nam de veerboot een stukje — de Cub op het "
            "dek, ik met een glimlach van oor tot oor."
        ),
        media=[
            MediaItem(tone="#7ea6b4", cap="Lac Léman"),
            MediaItem(tone="#5f938f", cap="Veerboot", video=True),
        ],
    ),
    StopCreate(
        place="Interlaken",
        country="Zwitserland",
        code="CH",
        lat=46.6863,
        lng=7.8632,
        date=date(2024, 5, 15),
        title="Carburateur op hoogte",
        km=742,
        weather="Koud, 6°",
        type="repair",
        broke=(
            "Bij de Grimselpass (2.046 m) begon de motor te haperen — te ijl "
            "mengsel op hoogte, hij sloeg af in de haarspeldbochten."
        ),
        fixed=(
            "Carburateur bijgesteld, stationair omhoog. Handen bevroren, maar "
            "hij liep weer als een naaimachine."
        ),
        story=(
            "De hoogte deed de Cub geen goed — hij snakte naar adem in de "
            "bochten. Met koude vingers de sproeier bijgesteld op een "
            "parkeerplaats met uitzicht dat elke schroef waard was."
        ),
        media=[
            MediaItem(tone="#6d7f8f", cap="Grimselpass"),
            MediaItem(tone="#9c4a3a", cap="Carburateur"),
            MediaItem(tone="#7ea6b4", cap="2046 m"),
        ],
    ),
    StopCreate(
        place="Milano",
        country="Italië",
        code="IT",
        lat=45.4642,
        lng=9.1900,
        date=date(2024, 5, 17),
        title="Italië in",
        km=908,
        weather="Warm, 26°",
        type="stop",
        story=(
            "Van de koude passen zo de warme Povlakte in — een klimaatsprong "
            "in één dag. Espresso staand aan de bar, de Cub dubbel geparkeerd "
            "zoals iedereen hier."
        ),
        media=[
            MediaItem(tone="#b26a4c", cap="Duomo"),
            MediaItem(tone="#c9a24e", cap="Navigli"),
        ],
    ),
    StopCreate(
        place="Cinque Terre",
        country="Italië",
        code="IT",
        lat=44.1350,
        lng=9.6845,
        date=date(2024, 5, 19),
        title="De zee",
        km=1024,
        weather="Zon, 24°",
        type="stop",
        story=(
            "Het laatste stuk omlaag naar de kust, en daar was de zee. 1.024 "
            "kilometer op een 50cc brommer, van de grachten tot de "
            "Middellandse Zee. Vanavond focaccia en niets te doen dan "
            "uitkijken."
        ),
        media=[
            MediaItem(tone="#7ea6b4", cap="De zee"),
            MediaItem(tone="#5f938f", cap="Vernazza"),
            MediaItem(tone="#b26a4c", cap="Focaccia", video=True),
            MediaItem(tone="#94a06a", cap="Aankomst"),
        ],
    ),
]


def seed_stops(session: Session) -> None:
    """Seed the sample trip once, if the stops table is empty."""
    existing = session.exec(select(func.count()).select_from(Stop)).one()
    if existing:
        return
    for i, stop_in in enumerate(TRIP):
        crud.create_stop(session=session, stop_in=stop_in, order_index=i)
