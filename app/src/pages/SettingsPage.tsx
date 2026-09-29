// Page Reglages : heros (compte et etats), navigation par sections (menu colle
// sur desktop, puces sur mobile) et sections : apparence, banque, categories,
// regles, donnees (sauvegarde, restauration, import YNAB, nouveau budget),
// securite, compte, a propos.

import { ChevronRight, Database, Info, Landmark, Palette, Shapes, ShieldCheck, UserRound, Wand2 } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useRules } from '@/lib/rules'
import { APP_VERSION } from '@/lib/version'
import { Card } from '@/components/ui/card'
import { SettingsHero } from '@/components/settings/SettingsHero'
import { AppearanceSection } from '@/components/settings/AppearanceSection'
import { BankSection } from '@/components/settings/BankSection'
import { CategoriesSection } from '@/components/settings/CategoriesSection'
import { MfaSection } from '@/components/settings/MfaSection'
import { NewBudgetSection } from '@/components/settings/NewBudgetSection'
import { AboutSection, AccountSection } from '@/components/settings/AccountSection'
import { BackupCard } from '@/components/settings/data/BackupCard'
import { YnabImportCard } from '@/components/settings/data/YnabImportCard'
import { Medallion } from '@/components/settings/shared/SettingsCard'
import {
  SettingsChips,
  SettingsSection,
  SettingsSideNav,
  useSettingsNav,
  type SettingsNavItem,
} from '@/components/settings/shared/SettingsNav'

const SECTIONS: SettingsNavItem[] = [
  { id: 'apparence', label: 'Apparence', icon: Palette },
  { id: 'banque', label: 'Banque', icon: Landmark },
  { id: 'categories', label: 'Catégories', icon: Shapes },
  { id: 'regles', label: 'Règles', icon: Wand2 },
  { id: 'donnees', label: 'Données', icon: Database },
  { id: 'securite', label: 'Sécurité', icon: ShieldCheck },
  { id: 'compte', label: 'Compte', icon: UserRound },
  { id: 'a-propos', label: 'À propos', icon: Info },
]

function RulesLink() {
  const { data: rules } = useRules()
  const count = rules?.length ?? null
  return (
    <Link to="/regles" className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
      <Card variant="interactive" className="flex items-center gap-3.5 p-5">
        <Medallion icon={Wand2} tone="accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-semibold tracking-tight">Règles de catégorisation</p>
          <p className="text-[13px] leading-relaxed text-soft">
            {count === null
              ? 'Catégorise automatiquement les transactions importées selon leur libellé.'
              : count === 0
                ? 'Aucune règle pour l’instant : crée la première pour trier tes imports tout seuls.'
                : `${count} règle${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}, appliquée${count > 1 ? 's' : ''} à chaque import bancaire.`}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-soft" />
      </Card>
    </Link>
  )
}

export function SettingsPage() {
  const [active, goTo] = useSettingsNav(SECTIONS)

  return (
    <div className="lg:flex lg:items-start lg:gap-10 xl:gap-12">
      <SettingsSideNav
        items={SECTIONS}
        active={active}
        onSelect={goTo}
        footer={
          <p className="text-[12px] leading-relaxed text-soft">
            Version
            <br />
            <span className="font-medium text-ink/80 tnum">{APP_VERSION}</span>
          </p>
        }
      />

      <div className="min-w-0 flex-1 space-y-4 lg:max-w-3xl">
        <SettingsHero onJump={goTo} />
        <SettingsChips items={SECTIONS} active={active} onSelect={goTo} />

        <div className="space-y-10 pt-2 lg:space-y-12">
          <SettingsSection
            id="apparence"
            icon={Palette}
            title="Apparence"
            description="Trois thèmes complets, chacun en clair et en sombre."
          >
            <AppearanceSection />
          </SettingsSection>

          <SettingsSection
            id="banque"
            icon={Landmark}
            title="Banque"
            description="Synchronisation automatique via Enable Banking, deux fois par jour."
          >
            <BankSection />
          </SettingsSection>

          <SettingsSection
            id="categories"
            icon={Shapes}
            title="Catégories"
            description="Renomme, réorganise, masque ou supprime tes groupes et enveloppes."
          >
            <CategoriesSection />
          </SettingsSection>

          <SettingsSection id="regles" icon={Wand2} title="Règles" description="Tes imports arrivent déjà triés.">
            <RulesLink />
          </SettingsSection>

          <SettingsSection
            id="donnees"
            icon={Database}
            title="Données"
            description="Sauvegarde, restauration, import YNAB et nouveau départ."
          >
            <div className="space-y-3">
              <BackupCard />
              <YnabImportCard />
              <NewBudgetSection />
            </div>
          </SettingsSection>

          <SettingsSection
            id="securite"
            icon={ShieldCheck}
            title="Sécurité"
            description="Protège l’accès à ton budget."
          >
            <MfaSection />
          </SettingsSection>

          <SettingsSection id="compte" icon={UserRound} title="Compte">
            <AccountSection />
          </SettingsSection>

          <SettingsSection id="a-propos" icon={Info} title="À propos">
            <AboutSection />
          </SettingsSection>
        </div>
      </div>
    </div>
  )
}
